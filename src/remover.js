/**
 * Remover Module
 * AST-based console statement removal with backup support
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const tar = require('tar');
const os = require('os');
const { 
  isLineByCurrentUser,
  getUncommittedLines,
  isLineUncommitted
} = require('./git');

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
 * Remove console statements from files
 * @param {string[]} filePaths - Files to process
 * @param {string[]} methodsToRemove - Console methods to remove
 * @param {boolean} dryRun - If true, don't actually modify files
 * @param {object} gitContext - Git filtering context (optional)
 */
async function removeConsoleStatements(filePaths, methodsToRemove, dryRun = false, gitContext = null) {
  let totalRemoved = 0;
  
  for (const filePath of filePaths) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const result = removeFromSource(content, methodsToRemove, filePath, gitContext);
      
      totalRemoved += result.removedCount;
      
      if (!dryRun && result.modified) {
        fs.writeFileSync(filePath, result.code, 'utf8');
      }
    } catch (error) {
      throw new Error(`Failed to process ${filePath}: ${error.message}`);
    }
  }
  
  return totalRemoved;
}

/**
 * Check if a call expression is a console method call
 * (Same logic as scanner for consistency)
 */
function isConsoleMethodCall(node, path, methodsToRemove) {
  const callee = node.callee;
  
  // Handle optional call expression (console?.log?.())
  if (callee.type === 'OptionalMemberExpression') {
    return checkMemberExpression(callee, path, methodsToRemove);
  }
  
  // Handle regular member expression (console.log or console['log'])
  if (callee.type === 'MemberExpression') {
    return checkMemberExpression(callee, path, methodsToRemove);
  }
  
  return null;
}

/**
 * Check if a member expression is accessing the console object
 */
function checkMemberExpression(memberExpr, path, methodsToRemove) {
  // Check if object is 'console' identifier
  if (memberExpr.object.type !== 'Identifier' || memberExpr.object.name !== 'console') {
    return null;
  }
  
  // Check if console is the global console (not shadowed)
  const isGlobal = !path.scope.hasBinding('console');
  if (!isGlobal) {
    return null; // Don't remove shadowed console
  }
  
  // Get the method name
  let method = null;
  
  if (memberExpr.property.type === 'Identifier' && !memberExpr.computed) {
    // console.log or console?.log
    method = memberExpr.property.name;
  } else if (memberExpr.property.type === 'StringLiteral' && memberExpr.computed) {
    // console['log']
    method = memberExpr.property.value;
  }
  
  if (!method || !methodsToRemove.includes(method)) {
    return null;
  }
  
  return { method, isGlobal: true };
}

/**
 * Remove console statements from source code
 * @param {string} sourceCode - Source code to process
 * @param {string[]} methodsToRemove - Console methods to remove
 * @param {string} filePath - Path to file being processed (for git blame)
 * @param {object} gitContext - Git filtering context (optional)
 */
function removeFromSource(sourceCode, methodsToRemove, filePath, gitContext = null) {
  let removedCount = 0;
  
  // Get uncommitted lines for this file if filtering by uncommitted changes
  let uncommittedLines = null;
  if (gitContext && gitContext.filterUncommitted && filePath) {
    if (!gitContext.uncommittedLinesCache.has(filePath)) {
      uncommittedLines = getUncommittedLines(filePath, gitContext.baseDir);
      gitContext.uncommittedLinesCache.set(filePath, uncommittedLines);
    } else {
      uncommittedLines = gitContext.uncommittedLinesCache.get(filePath);
    }
  }
  
  try {
    // Parse source code
    const ast = parse(sourceCode, {
      sourceType: 'unambiguous',
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
      ]
    });
    
    // Traverse and remove console statements
    traverse(ast, {
      CallExpression(path) {
        const { node } = path;
        
        // Check if this is a console.method() call we should remove
        const isConsoleCall = isConsoleMethodCall(node, path, methodsToRemove);
        
        if (isConsoleCall) {
          const lineNumber = node.loc.start.line;
          
          // Apply git author filtering if enabled
          if (gitContext && gitContext.filterMine && filePath) {
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
          if (gitContext && gitContext.filterUncommitted && filePath) {
            const isUncommitted = isLineUncommitted(lineNumber, uncommittedLines);
            
            // Skip this statement if not in uncommitted changes
            if (!isUncommitted) {
              return;
            }
          }
          
          // Skip if has side effects and user wants to skip them
          if (gitContext && gitContext.skipSideEffects) {
            const hasSideEffects = detectSideEffects(node.arguments);
            if (hasSideEffects) {
              return;
            }
          }
          
          // Check if it's an expression statement (can be safely removed)
          if (path.parent.type === 'ExpressionStatement') {
            path.parentPath.remove();
            removedCount++;
          } else {
            // It's used in an expression (e.g., const x = console.log(y))
            // Replace with undefined to maintain syntax
            path.replaceWith({
              type: 'Identifier',
              name: 'undefined'
            });
            removedCount++;
          }
        }
      }
    });
    
    // Generate code from modified AST
    const output = generate(ast, {
      retainLines: true, // Try to keep line numbers similar
      compact: false,
      comments: true
    }, sourceCode);
    
    return {
      code: output.code,
      modified: removedCount > 0,
      removedCount
    };
    
  } catch (error) {
    throw new Error(`Parse/transform error: ${error.message}`);
  }
}

/**
 * Create backup of files before modification
 */
async function createBackup(filePaths, baseDir) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `log-sweep-backup-${timestamp}.tar.gz`;
  const backupPath = path.join(os.tmpdir(), backupFileName);
  
  // Create backup archive
  await tar.create(
    {
      gzip: true,
      file: backupPath,
      cwd: path.dirname(baseDir)
    },
    filePaths.map(f => path.relative(path.dirname(baseDir), f))
  );
  
  return backupPath;
}

/**
 * Restore files from backup
 */
async function restoreBackup(backupPath) {
  // Extract to original locations
  await tar.extract({
    file: backupPath,
    cwd: process.cwd()
  });
}

module.exports = {
  removeConsoleStatements,
  removeFromSource,
  createBackup,
  restoreBackup
};

