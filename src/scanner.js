/**
 * Scanner Module
 * AST-based console statement scanner
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { glob } = require('glob');
const { 
  isGitRepository, 
  getCurrentGitUser, 
  getUncommittedFiles,
  isLineByCurrentUser,
  isFileUncommitted,
  getUncommittedLines,
  isLineUncommitted
} = require('./git');

/**
 * Check if a call expression is a console method call
 * Supports: console.log(), console['log'](), console?.log(), etc.
 * @param {object} node - AST node to check
 * @param {object} path - Babel path object
 * @returns {object|null} { method: string, isGlobal: boolean } or null
 */
function isConsoleMethodCall(node, path) {
  const callee = node.callee;
  
  // Handle optional call expression (console?.log?.())
  if (callee.type === 'OptionalMemberExpression') {
    return checkMemberExpression(callee, path);
  }
  
  // Handle regular member expression (console.log or console['log'])
  if (callee.type === 'MemberExpression') {
    return checkMemberExpression(callee, path);
  }
  
  return null;
}

/**
 * Check if a member expression is accessing the console object
 * @param {object} memberExpr - MemberExpression or OptionalMemberExpression node
 * @param {object} path - Babel path object
 * @returns {object|null} { method: string, isGlobal: boolean } or null
 */
function checkMemberExpression(memberExpr, path) {
  // Check if object is 'console' identifier
  if (memberExpr.object.type !== 'Identifier' || memberExpr.object.name !== 'console') {
    return null;
  }
  
  // Check if console is the global console (not shadowed)
  const isGlobal = !path.scope.hasBinding('console');
  
  // Get the method name
  let method = null;
  
  if (memberExpr.property.type === 'Identifier' && !memberExpr.computed) {
    // console.log or console?.log
    method = memberExpr.property.name;
  } else if (memberExpr.property.type === 'StringLiteral' && memberExpr.computed) {
    // console['log']
    method = memberExpr.property.value;
  }
  
  if (!method) {
    return null;
  }
  
  // Check if it's a known console method
  const knownMethods = [
    'log', 'warn', 'info', 'debug', 'error', 'trace', 'table', 'dir', 'dirxml',
    'assert', 'count', 'countReset', 'time', 'timeEnd', 'timeLog', 'timeStamp',
    'group', 'groupCollapsed', 'groupEnd', 'profile', 'profileEnd', 'clear'
  ];
  
  if (!knownMethods.includes(method)) {
    return null;
  }
  
  return { method, isGlobal };
}

/**
 * Detect potential side effects in console arguments
 * @param {array} args - Array of argument nodes
 * @returns {boolean} True if side effects detected
 */
function detectSideEffects(args) {
  let hasSideEffects = false;
  
  // Traverse arguments looking for side effects
  for (const arg of args) {
    traverse.default.cheap(arg, node => {
      // Update expressions: ++, --
      if (node.type === 'UpdateExpression') {
        hasSideEffects = true;
      }
      // Assignment expressions: =, +=, etc.
      if (node.type === 'AssignmentExpression') {
        hasSideEffects = true;
      }
      // Await expressions
      if (node.type === 'AwaitExpression') {
        hasSideEffects = true;
      }
      // Yield expressions
      if (node.type === 'YieldExpression') {
        hasSideEffects = true;
      }
    });
  }
  
  return hasSideEffects;
}

/**
 * Scan a directory for console statements
 * @param {string} directory - Directory to scan
 * @param {string[]} excludePatterns - Patterns to exclude
 * @param {object} gitOptions - Git filtering options: { gitMine: boolean, gitUncommitted: boolean }
 */
async function scanDirectory(directory, excludePatterns = [], gitOptions = {}) {
  const results = {
    totalCount: 0,
    fileCount: 0,
    byMethod: initializeMethodStats(),
    byFile: {},
    gitFiltered: false,
    gitFilterInfo: null
  };
  
  // Setup git filtering if requested
  let gitContext = null;
  if (gitOptions.gitMine || gitOptions.gitUncommitted) {
    if (!isGitRepository(directory)) {
      throw new Error('Git filtering requested but directory is not a git repository');
    }
    
    gitContext = {
      enabled: true,
      filterMine: gitOptions.gitMine,
      filterUncommitted: gitOptions.gitUncommitted,
      currentUser: null,
      uncommittedFiles: null,
      uncommittedLinesCache: new Map(), // Cache for line-level uncommitted changes
      blameCache: new Map(),
      baseDir: directory
    };
    
    if (gitOptions.gitMine) {
      gitContext.currentUser = getCurrentGitUser(directory);
      results.gitFiltered = true;
      results.gitFilterInfo = `Filtered to console statements by: ${gitContext.currentUser.name} <${gitContext.currentUser.email}>`;
    }
    
    if (gitOptions.gitUncommitted) {
      gitContext.uncommittedFiles = getUncommittedFiles(directory);
      results.gitFiltered = true;
      results.gitFilterInfo = gitOptions.gitMine 
        ? `${results.gitFilterInfo} (uncommitted changes only)`
        : 'Filtered to uncommitted changes only';
    }
  }
  
  // Find all JavaScript files
  let files = await findJavaScriptFiles(directory, excludePatterns);
  
  // Filter to uncommitted files if requested
  if (gitContext && gitContext.filterUncommitted) {
    files = files.filter(file => isFileUncommitted(file, gitContext.uncommittedFiles));
  }
  
  // Scan each file
  for (const file of files) {
    try {
      const fileResults = await scanFile(file, gitContext);
      
      if (fileResults.statements.length > 0) {
        results.byFile[file] = fileResults;
        results.fileCount++;
        results.totalCount += fileResults.count;
        
        // Update method statistics
        fileResults.statements.forEach(stmt => {
          results.byMethod[stmt.method].count++;
          results.byMethod[stmt.method].files.add(file);
        });
      }
    } catch (error) {
      // Skip files that can't be parsed (minified, non-standard syntax, etc.)
      if (process.env.DEBUG) {
        console.error(`Warning: Could not parse ${file}: ${error.message}`);
      }
    }
  }
  
  // Convert Sets to arrays for JSON serialization
  Object.keys(results.byMethod).forEach(method => {
    results.byMethod[method].files = Array.from(results.byMethod[method].files);
  });
  
  return results;
}

/**
 * Scan a single file for console statements
 * @param {string} filePath - Path to file
 * @param {object} gitContext - Git filtering context (optional)
 */
async function scanFile(filePath, gitContext = null) {
  const content = fs.readFileSync(filePath, 'utf8');
  const statements = [];
  
  try {
    // Parse with Babel (handles modern JS syntax)
    const ast = parse(content, {
      sourceType: 'unambiguous', // Auto-detect module vs script
      plugins: [
        'jsx',
        'typescript',
        'decorators-legacy',
        'classProperties',
        'dynamicImport',
        'objectRestSpread',
        'asyncGenerators',
        'optionalChaining',
        'nullishCoalescingOperator'
      ],
      errorRecovery: true
    });
    
    // Traverse AST and find console statements
    traverse(ast, {
      CallExpression(path) {
        const { node } = path;
        
        // Check if this is a console.method() call
        // Support direct property access (console.log) and optional chaining (console?.log)
        const isConsoleCall = isConsoleMethodCall(node, path);
        
        if (isConsoleCall) {
          const { method, isGlobal } = isConsoleCall;
          const loc = node.loc;
          const lineNumber = loc.start.line;
          
          // Skip if console is shadowed (not the global console)
          if (!isGlobal) {
            return;
          }
          
          // Apply git filtering if enabled
          if (gitContext && gitContext.filterMine) {
            const isMyLine = isLineByCurrentUser(
              filePath, 
              lineNumber, 
              gitContext.currentUser.email,
              gitContext.blameCache,
              gitContext.baseDir
            );
            
            // Skip this statement if not authored by current user
            if (!isMyLine) {
              return;
            }
          }
          
          // Apply uncommitted line filtering if enabled
          if (gitContext && gitContext.filterUncommitted) {
            // Get uncommitted lines for this file (cached)
            if (!gitContext.uncommittedLinesCache.has(filePath)) {
              const uncommittedLines = getUncommittedLines(filePath, gitContext.baseDir);
              gitContext.uncommittedLinesCache.set(filePath, uncommittedLines);
            }
            
            const uncommittedLines = gitContext.uncommittedLinesCache.get(filePath);
            const isUncommitted = isLineUncommitted(lineNumber, uncommittedLines);
            
            // Skip this statement if not in uncommitted changes
            if (!isUncommitted) {
              return;
            }
          }
          
          // Detect potential side effects in arguments
          const hasSideEffects = detectSideEffects(node.arguments);
          
          statements.push({
            method,
            line: lineNumber,
            column: loc.start.column,
            endLine: loc.end.line,
            endColumn: loc.end.column,
            code: getCodeSnippet(content, loc),
            hasSideEffects: hasSideEffects
          });
        }
      }
    });
    
  } catch (error) {
    // Re-throw parsing errors for the caller to handle
    throw new Error(`Parse error in ${filePath}: ${error.message}`);
  }
  
  return {
    file: filePath,
    count: statements.length,
    statements: statements.sort((a, b) => a.line - b.line)
  };
}

/**
 * Find all JavaScript files in directory
 */
async function findJavaScriptFiles(directory, excludePatterns) {
  const pattern = path.join(directory, '**/*.{js,jsx,ts,tsx,mjs,cjs}');
  
  const ignorePatterns = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/*.min.js',
    ...excludePatterns.map(p => `**/${p}/**`)
  ];
  
  const files = await glob(pattern, {
    ignore: ignorePatterns,
    nodir: true,
    absolute: true
  });
  
  return files;
}

/**
 * Get code snippet for a location
 */
function getCodeSnippet(content, loc) {
  const lines = content.split('\n');
  
  if (loc.start.line === loc.end.line) {
    // Single line
    const line = lines[loc.start.line - 1];
    return line.substring(loc.start.column, loc.end.column).trim();
  } else {
    // Multi-line - show first and last line
    const firstLine = lines[loc.start.line - 1].substring(loc.start.column).trim();
    const lastLine = lines[loc.end.line - 1].substring(0, loc.end.column).trim();
    
    if (loc.end.line - loc.start.line === 1) {
      return `${firstLine} ${lastLine}`;
    } else {
      return `${firstLine} ... ${lastLine}`;
    }
  }
}

/**
 * Initialize method statistics object
 */
function initializeMethodStats() {
  const methods = [
    'log', 'warn', 'info', 'debug', 'error', 'trace', 'table', 'dir', 'dirxml',
    'assert', 'count', 'countReset', 'time', 'timeEnd', 'timeLog', 'timeStamp',
    'group', 'groupCollapsed', 'groupEnd', 'profile', 'profileEnd', 'clear'
  ];
  const stats = {};
  
  methods.forEach(method => {
    stats[method] = {
      count: 0,
      files: new Set()
    };
  });
  
  return stats;
}

module.exports = {
  scanDirectory,
  scanFile
};

