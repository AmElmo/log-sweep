#!/usr/bin/env node

/**
 * log-sweep CLI
 * Interactive tool to scan and remove console statements safely using AST
 */

const { program } = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const path = require('path');
const fs = require('fs');
const { scanDirectory } = require('./scanner');
const { removeConsoleStatements, createBackup, restoreBackup } = require('./remover');
const { getCurrentGitUser, isGitRepository } = require('./git');

// CLI version
const VERSION = '1.0.0';

// Console method types
const CONSOLE_METHODS = ['log', 'warn', 'info', 'debug', 'error', 'trace', 'table', 'dir', 'dirxml'];

program
  .name('log-sweep')
  .description('Interactive CLI to scan and remove console statements safely')
  .version(VERSION);

// Scan command
program
  .command('scan [directory]')
  .description('Scan directory for console statements')
  .option('-e, --exclude <patterns...>', 'Exclude patterns (e.g., node_modules test)')
  .option('-o, --output <file>', 'Output results to JSON file')
  .option('--git-mine', 'Only show console statements authored by you (git blame)')
  .option('--git-uncommitted', 'Only show console statements in uncommitted changes')
  .action(async (directory = '.', options) => {
    await scanCommand(directory, options);
  });

// Remove command (interactive)
program
  .command('remove [directory]')
  .description('Interactively remove console statements')
  .option('-e, --exclude <patterns...>', 'Exclude patterns (e.g., node_modules test)')
  .option('--no-backup', 'Skip creating backup before removal')
  .option('--dry-run', 'Preview changes without applying them')
  .option('--git-mine', 'Only remove console statements authored by you (git blame)')
  .option('--git-uncommitted', 'Only remove console statements in uncommitted changes')
  .action(async (directory = '.', options) => {
    await removeCommand(directory, options);
  });

// Restore command
program
  .command('restore [backupFile]')
  .description('Restore from backup')
  .action(async (backupFile) => {
    await restoreCommand(backupFile);
  });

// Default action (show help)
if (process.argv.length === 2) {
  program.help();
}

program.parse(process.argv);

/**
 * Scan command implementation
 */
async function scanCommand(directory, options) {
  console.log(chalk.cyan.bold('\n🔍 Console Statement Scanner\n'));
  
  // Show git filtering info
  if (options.gitMine || options.gitUncommitted) {
    let filterMsg = '🔎 Git filtering: ';
    if (options.gitMine) filterMsg += 'Only your statements';
    if (options.gitMine && options.gitUncommitted) filterMsg += ' + ';
    if (options.gitUncommitted) filterMsg += 'Uncommitted changes only';
    console.log(chalk.yellow(filterMsg + '\n'));
  }
  
  const spinner = ora('Scanning files...').start();
  
  try {
    const targetDir = path.resolve(process.cwd(), directory);
    
    if (!fs.existsSync(targetDir)) {
      spinner.fail(chalk.red(`Directory not found: ${targetDir}`));
      process.exit(1);
    }
    
    const gitOptions = {
      gitMine: options.gitMine || false,
      gitUncommitted: options.gitUncommitted || false
    };
    
    const results = await scanDirectory(
      targetDir, 
      options.exclude || ['node_modules', '.git', 'dist', 'build'],
      gitOptions
    );
    
    spinner.succeed(chalk.green('Scan complete!'));
    
    // Show git filter info if applied
    if (results.gitFiltered && results.gitFilterInfo) {
      console.log(chalk.cyan(`\n📌 ${results.gitFilterInfo}`));
    }
    
    // Display results
    displayScanResults(results);
    
    // Save to file if requested
    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(results, null, 2));
      console.log(chalk.green(`\n✓ Results saved to ${options.output}`));
    }
    
  } catch (error) {
    spinner.fail(chalk.red('Scan failed'));
    console.error(chalk.red(error.message));
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Remove command implementation
 */
async function removeCommand(directory, options) {
  console.log(chalk.cyan.bold('\n🧹 Console Statement Remover\n'));
  
  // Show git filtering info
  if (options.gitMine || options.gitUncommitted) {
    let filterMsg = '🔎 Git filtering: ';
    if (options.gitMine) filterMsg += 'Only your statements';
    if (options.gitMine && options.gitUncommitted) filterMsg += ' + ';
    if (options.gitUncommitted) filterMsg += 'Uncommitted changes only';
    console.log(chalk.yellow(filterMsg + '\n'));
  }
  
  const spinner = ora('Scanning files...').start();
  
  try {
    const targetDir = path.resolve(process.cwd(), directory);
    
    if (!fs.existsSync(targetDir)) {
      spinner.fail(chalk.red(`Directory not found: ${targetDir}`));
      process.exit(1);
    }
    
    const gitOptions = {
      gitMine: options.gitMine || false,
      gitUncommitted: options.gitUncommitted || false
    };
    
    const results = await scanDirectory(
      targetDir, 
      options.exclude || ['node_modules', '.git', 'dist', 'build'],
      gitOptions
    );
    
    spinner.succeed(chalk.green('Scan complete!'));
    
    // Show git filter info if applied
    if (results.gitFiltered && results.gitFilterInfo) {
      console.log(chalk.cyan(`\n📌 ${results.gitFilterInfo}`));
    }
    
    if (results.totalCount === 0) {
      console.log(chalk.yellow('\n✨ No console statements found!'));
      return;
    }
    
    // Display summary
    displayScanResults(results);
    
    // Check for side effects
    const sideEffectStatements = [];
    Object.keys(results.byFile).forEach(file => {
      results.byFile[file].statements.forEach(stmt => {
        if (stmt.hasSideEffects) {
          sideEffectStatements.push({ file, stmt });
        }
      });
    });
    
    // Show side effects warning if any found
    if (sideEffectStatements.length > 0) {
      console.log(chalk.yellow.bold('\n⚠️  Warning: Potential Side Effects Detected\n'));
      console.log(chalk.yellow(`Found ${sideEffectStatements.length} console statement${sideEffectStatements.length === 1 ? '' : 's'} with potential side effects:`));
      console.log(chalk.gray('(e.g., ++, --, assignments, await, yield)\n'));
      
      // Show first few examples
      sideEffectStatements.slice(0, 5).forEach(({ file, stmt }) => {
        const relPath = path.relative(targetDir, file);
        console.log(chalk.gray(`  • ${relPath}:${stmt.line}`));
        console.log(chalk.gray(`    ${stmt.code}`));
      });
      
      if (sideEffectStatements.length > 5) {
        console.log(chalk.gray(`  ... and ${sideEffectStatements.length - 5} more\n`));
      } else {
        console.log('');
      }
    }
    
    // Interactive selection
    console.log(chalk.cyan.bold('\n📋 Select console methods to remove:\n'));
    
    const methodChoices = Object.keys(results.byMethod)
      .filter(method => results.byMethod[method].count > 0)
      .map(method => {
        const methodData = results.byMethod[method];
        const sideEffectCount = Object.keys(results.byFile).reduce((count, file) => {
          return count + results.byFile[file].statements.filter(s => 
            s.method === method && s.hasSideEffects
          ).length;
        }, 0);
        
        const label = sideEffectCount > 0 
          ? `${chalk.yellow(method.padEnd(8))} - ${methodData.count} occurrence${methodData.count === 1 ? '' : 's'} ${chalk.red('(⚠️ ' + sideEffectCount + ' with side effects)')}`
          : `${chalk.yellow(method.padEnd(8))} - ${methodData.count} occurrence${methodData.count === 1 ? '' : 's'}`;
        
        return {
          name: label,
          value: method,
          checked: method !== 'error' // Don't check error by default
        };
      });
    
    const promptQuestions = [
      {
        type: 'checkbox',
        name: 'methods',
        message: 'Which console methods should be removed?',
        choices: methodChoices,
        validate: (answer) => {
          if (answer.length === 0) {
            return 'You must select at least one method to remove';
          }
          return true;
        }
      }
    ];
    
    // Add side effects handling option if any found
    if (sideEffectStatements.length > 0) {
      promptQuestions.push({
        type: 'list',
        name: 'sideEffectsHandling',
        message: 'How should statements with side effects be handled?',
        choices: [
          { name: '⊙ Skip them (safer - keep statements with side effects)', value: 'skip' },
          { name: '○ Remove them anyway (risky - may break code logic)', value: 'remove' }
        ],
        default: 'skip'
      });
    }
    
    promptQuestions.push({
      type: 'confirm',
      name: 'preview',
      message: 'Would you like to preview changes before applying?',
      default: true
    });
    
    const answers = await inquirer.prompt(promptQuestions);
    
    if (answers.methods.length === 0) {
      console.log(chalk.yellow('\n⚠️  No methods selected. Exiting.'));
      return;
    }
    
    // Calculate what will be removed
    const filesToModify = new Set();
    let statementsToRemove = 0;
    let statementsSkipped = 0;
    
    const skipSideEffects = answers.sideEffectsHandling === 'skip';
    
    Object.keys(results.byFile).forEach(file => {
      const fileData = results.byFile[file];
      const statementsToRemoveInFile = fileData.statements.filter(stmt => {
        const shouldRemoveMethod = answers.methods.includes(stmt.method);
        if (!shouldRemoveMethod) return false;
        
        // Skip if has side effects and user chose to skip them
        if (skipSideEffects && stmt.hasSideEffects) {
          statementsSkipped++;
          return false;
        }
        
        return true;
      });
      
      if (statementsToRemoveInFile.length > 0) {
        filesToModify.add(file);
        statementsToRemove += statementsToRemoveInFile.length;
      }
    });
    
    // Show preview
    if (answers.preview) {
      console.log(chalk.cyan.bold('\n📄 Preview of changes:\n'));
      console.log(chalk.white(`Files to modify: ${filesToModify.size}`));
      console.log(chalk.white(`Statements to remove: ${statementsToRemove}`));
      if (statementsSkipped > 0) {
        console.log(chalk.yellow(`Statements to skip (side effects): ${statementsSkipped}`));
      }
      console.log(chalk.white(`Methods: ${answers.methods.join(', ')}\n`));
      
      // Show affected files
      Array.from(filesToModify).slice(0, 10).forEach(file => {
        const relPath = path.relative(targetDir, file);
        const count = results.byFile[file].statements.filter(stmt => {
          const shouldRemove = answers.methods.includes(stmt.method);
          if (!shouldRemove) return false;
          if (skipSideEffects && stmt.hasSideEffects) return false;
          return true;
        }).length;
        console.log(chalk.gray(`  • ${relPath} (${count} statement${count === 1 ? '' : 's'})`));
      });
      
      if (filesToModify.size > 10) {
        console.log(chalk.gray(`  ... and ${filesToModify.size - 10} more files`));
      }
    }
    
    // Confirm
    const confirmAnswer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: options.dryRun 
          ? chalk.yellow('This is a DRY RUN. Continue with preview?')
          : chalk.red('⚠️  This will modify your files. Continue?'),
        default: false
      }
    ]);
    
    if (!confirmAnswer.proceed) {
      console.log(chalk.yellow('\n✋ Operation cancelled.'));
      return;
    }
    
    // Create backup
    let backupPath = null;
    if (options.backup && !options.dryRun) {
      const backupSpinner = ora('Creating backup...').start();
      try {
        backupPath = await createBackup(Array.from(filesToModify), targetDir);
        backupSpinner.succeed(chalk.green(`Backup created: ${backupPath}`));
      } catch (error) {
        backupSpinner.fail(chalk.red('Backup failed'));
        console.error(chalk.red(error.message));
        return;
      }
    }
    
    // Setup git context for removal if needed
    let removerGitContext = null;
    if (gitOptions.gitMine || gitOptions.gitUncommitted || answers.sideEffectsHandling === 'skip') {
      removerGitContext = {
        enabled: true,
        filterMine: gitOptions.gitMine,
        filterUncommitted: gitOptions.gitUncommitted,
        currentUser: gitOptions.gitMine ? getCurrentGitUser(targetDir) : null,
        blameCache: new Map(),
        uncommittedLinesCache: new Map(), // Line-level uncommitted change cache
        skipSideEffects: answers.sideEffectsHandling === 'skip',
        baseDir: targetDir
      };
    }
    
    // Remove console statements
    const removeSpinner = ora(options.dryRun ? 'Analyzing...' : 'Removing console statements...').start();
    
    try {
      const removedCount = await removeConsoleStatements(
        Array.from(filesToModify),
        answers.methods,
        options.dryRun,
        removerGitContext
      );
      
      removeSpinner.succeed(chalk.green(
        options.dryRun 
          ? `✓ Dry run complete: Would remove ${removedCount} statements`
          : `✓ Successfully removed ${removedCount} console statements!`
      ));
      
      if (backupPath && !options.dryRun) {
        console.log(chalk.cyan(`\n💡 To restore, run: log-sweep restore ${backupPath}`));
      }
      
    } catch (error) {
      removeSpinner.fail(chalk.red('Removal failed'));
      console.error(chalk.red(error.message));
      
      if (backupPath) {
        console.log(chalk.yellow('\n🔄 Restoring from backup...'));
        await restoreBackup(backupPath);
        console.log(chalk.green('✓ Backup restored successfully'));
      }
      
      process.exit(1);
    }
    
  } catch (error) {
    spinner.fail(chalk.red('Operation failed'));
    console.error(chalk.red(error.message));
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Restore command implementation
 */
async function restoreCommand(backupFile) {
  console.log(chalk.cyan.bold('\n🔄 Restore from Backup\n'));
  
  if (!backupFile) {
    console.error(chalk.red('❌ Please specify a backup file'));
    console.log(chalk.gray('Usage: log-sweep restore <backup-file.tar.gz>'));
    process.exit(1);
  }
  
  const backupPath = path.resolve(process.cwd(), backupFile);
  
  if (!fs.existsSync(backupPath)) {
    console.error(chalk.red(`❌ Backup file not found: ${backupPath}`));
    process.exit(1);
  }
  
  const spinner = ora('Restoring files...').start();
  
  try {
    await restoreBackup(backupPath);
    spinner.succeed(chalk.green('✓ Files restored successfully!'));
  } catch (error) {
    spinner.fail(chalk.red('Restore failed'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

/**
 * Display scan results in a formatted way
 */
function displayScanResults(results) {
  console.log(chalk.white.bold('\n📊 Scan Results:\n'));
  
  // Summary
  console.log(chalk.white(`Total console statements: ${chalk.yellow.bold(results.totalCount)}`));
  console.log(chalk.white(`Files with console statements: ${chalk.yellow.bold(results.fileCount)}`));
  
  // By method
  console.log(chalk.white.bold('\n📋 By Method:\n'));
  Object.keys(results.byMethod)
    .filter(method => results.byMethod[method].count > 0)
    .sort((a, b) => results.byMethod[b].count - results.byMethod[a].count)
    .forEach(method => {
      const data = results.byMethod[method];
      const color = method === 'error' ? chalk.red : 
                    method === 'warn' ? chalk.yellow :
                    method === 'log' ? chalk.blue : chalk.gray;
      console.log(color(`  ${method.padEnd(8)} : ${data.count.toString().padStart(4)} occurrence${data.count === 1 ? '' : 's'}`));
    });
  
  // Top files
  const sortedFiles = Object.entries(results.byFile)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);
  
  if (sortedFiles.length > 0) {
    console.log(chalk.white.bold('\n📁 Top Files:\n'));
    sortedFiles.forEach(([file, data], index) => {
      const relPath = path.relative(process.cwd(), file);
      console.log(chalk.gray(`  ${(index + 1).toString().padStart(2)}. ${relPath} (${data.count})`));
    });
    
    if (Object.keys(results.byFile).length > 10) {
      console.log(chalk.gray(`  ... and ${Object.keys(results.byFile).length - 10} more files`));
    }
  }
}

