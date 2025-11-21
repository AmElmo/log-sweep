/**
 * Git Utilities Module
 * Helper functions for git-based filtering
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Check if a directory is a git repository
 */
function isGitRepository(directory) {
  try {
    execSync('git rev-parse --git-dir', { 
      cwd: directory, 
      stdio: 'ignore' 
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get current git user email
 */
function getCurrentGitUser(directory) {
  try {
    const email = execSync('git config user.email', { 
      cwd: directory,
      encoding: 'utf8' 
    }).trim();
    
    const name = execSync('git config user.name', { 
      cwd: directory,
      encoding: 'utf8' 
    }).trim();
    
    return { email, name };
  } catch (error) {
    throw new Error('Could not get git user. Make sure git is configured (git config user.email)');
  }
}

/**
 * Get git blame information for a file
 * Returns a map of line numbers to author emails
 */
function getFileBlame(filePath, baseDir) {
  try {
    // Use porcelain format for easier parsing
    const output = execSync(`git blame --line-porcelain "${filePath}"`, {
      cwd: baseDir,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large files
    });
    
    const lineAuthors = new Map();
    const lines = output.split('\n');
    let currentLine = 0;
    let currentAuthorEmail = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Line format: <commit-hash> <original-line> <final-line> <num-lines>
      if (line.match(/^[a-f0-9]{40}/)) {
        currentLine = parseInt(line.split(' ')[2]);
      }
      
      // Author email line
      if (line.startsWith('author-mail ')) {
        // Format: author-mail <email@example.com>
        currentAuthorEmail = line.substring(13, line.length - 1); // Remove 'author-mail <' and '>'
        if (currentLine > 0 && currentAuthorEmail) {
          lineAuthors.set(currentLine, currentAuthorEmail);
        }
      }
    }
    
    return lineAuthors;
  } catch (error) {
    // File might not be tracked by git (new file)
    if (process.env.DEBUG) {
      console.error(`Warning: Could not get git blame for ${filePath}: ${error.message}`);
    }
    return null;
  }
}

/**
 * Get list of uncommitted files (both staged and unstaged changes)
 */
function getUncommittedFiles(directory) {
  try {
    // Get modified, added, and untracked files
    const output = execSync('git status --porcelain', {
      cwd: directory,
      encoding: 'utf8'
    });
    
    const files = new Set();
    const lines = output.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      // Format: XY filename
      // X = staged status, Y = unstaged status
      // Examples: " M file.js", "M  file.js", "A  file.js", "?? file.js"
      const status = line.substring(0, 2);
      const filename = line.substring(3).trim();
      
      // Remove quotes if present
      const cleanFilename = filename.replace(/^"|"$/g, '');
      
      // Convert to absolute path
      const absolutePath = path.resolve(directory, cleanFilename);
      files.add(absolutePath);
    }
    
    return files;
  } catch (error) {
    throw new Error(`Could not get git status: ${error.message}`);
  }
}

/**
 * Check if a line in a file was authored by the current user
 */
function isLineByCurrentUser(filePath, lineNumber, currentUserEmail, blameCache, baseDir) {
  // Check cache first
  if (!blameCache.has(filePath)) {
    const blame = getFileBlame(filePath, baseDir);
    blameCache.set(filePath, blame);
  }
  
  const blame = blameCache.get(filePath);
  
  // If no blame info (new file), consider it authored by current user
  if (!blame) {
    return true;
  }
  
  const authorEmail = blame.get(lineNumber);
  return authorEmail === currentUserEmail;
}

/**
 * Check if a file has uncommitted changes
 */
function isFileUncommitted(filePath, uncommittedFiles) {
  return uncommittedFiles.has(filePath);
}

/**
 * Get uncommitted line ranges for a file
 * Returns a Set of line numbers that have been added or modified in uncommitted changes
 * @param {string} filePath - Absolute path to file
 * @param {string} baseDir - Base directory for git operations
 * @returns {Set<number>|null} Set of uncommitted line numbers, or null if file is not modified
 */
function getUncommittedLines(filePath, baseDir) {
  try {
    const relPath = path.relative(baseDir, filePath);
    
    // Get diff for this specific file
    // Use --unified=0 to get only changed lines without context
    const output = execSync(`git diff --unified=0 HEAD "${relPath}"`, {
      cwd: baseDir,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    
    if (!output.trim()) {
      // No diff means file is not modified or is untracked
      // Check if file is untracked (new file) - if so, all lines are "uncommitted"
      try {
        execSync(`git ls-files --error-unmatch "${relPath}"`, {
          cwd: baseDir,
          stdio: 'ignore'
        });
        // File is tracked but has no diff
        return null;
      } catch (error) {
        // File is untracked - all lines are uncommitted
        return 'all'; // Special marker for untracked files
      }
    }
    
    const uncommittedLines = new Set();
    const lines = output.split('\n');
    
    for (const line of lines) {
      // Parse diff hunk headers: @@ -start,count +start,count @@
      const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        const startLine = parseInt(match[1]);
        const lineCount = match[2] ? parseInt(match[2]) : 1;
        
        // Add all lines in this hunk to the set
        for (let i = 0; i < lineCount; i++) {
          uncommittedLines.add(startLine + i);
        }
      }
    }
    
    return uncommittedLines;
  } catch (error) {
    if (process.env.DEBUG) {
      console.error(`Warning: Could not get git diff for ${filePath}: ${error.message}`);
    }
    return null;
  }
}

/**
 * Check if a specific line in a file is uncommitted
 * @param {number} lineNumber - Line number to check (1-indexed)
 * @param {Set<number>|string|null} uncommittedLines - Set of uncommitted line numbers, 'all', or null
 * @returns {boolean} True if line is uncommitted
 */
function isLineUncommitted(lineNumber, uncommittedLines) {
  if (!uncommittedLines) {
    return false; // No uncommitted changes
  }
  if (uncommittedLines === 'all') {
    return true; // Untracked file - all lines are uncommitted
  }
  return uncommittedLines.has(lineNumber);
}

module.exports = {
  isGitRepository,
  getCurrentGitUser,
  getFileBlame,
  getUncommittedFiles,
  isLineByCurrentUser,
  isFileUncommitted,
  getUncommittedLines,
  isLineUncommitted
};

