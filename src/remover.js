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
  isLineByCurrentUser 
} = require('./git');

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
 * Remove console statements from source code
 * @param {string} sourceCode - Source code to process
 * @param {string[]} methodsToRemove - Console methods to remove
 * @param {string} filePath - Path to file being processed (for git blame)
 * @param {object} gitContext - Git filtering context (optional)
 */
function removeFromSource(sourceCode, methodsToRemove, filePath, gitContext = null) {
  let removedCount = 0;
  
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
        
        // Check if this is a console.method() call
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'console' &&
          node.callee.property.type === 'Identifier' &&
          methodsToRemove.includes(node.callee.property.name)
        ) {
          // Apply git filtering if enabled
          if (gitContext && gitContext.filterMine && filePath) {
            const lineNumber = node.loc.start.line;
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

