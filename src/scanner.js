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
  isFileUncommitted
} = require('./git');

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
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'console' &&
          node.callee.property.type === 'Identifier'
        ) {
          const method = node.callee.property.name;
          const loc = node.loc;
          const lineNumber = loc.start.line;
          
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
          
          statements.push({
            method,
            line: lineNumber,
            column: loc.start.column,
            endLine: loc.end.line,
            endColumn: loc.end.column,
            code: getCodeSnippet(content, loc)
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
  const methods = ['log', 'warn', 'info', 'debug', 'error', 'trace', 'table', 'dir', 'dirxml', 'assert', 'count', 'time', 'timeEnd'];
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

