# 🧹 log-sweep

**Production-grade interactive CLI tool to scan and selectively remove console statements using AST parsing.**

Safely handles all edge cases that regex-based tools miss: strings containing parentheses, template literals, nested expressions, regex patterns, and more.

## ✨ Features

- 🔍 **AST-Based Scanning** - Uses Babel parser to understand JavaScript syntax perfectly
- 🎯 **Selective Removal** - Choose which console methods to remove (log, warn, info, debug, error, etc.)
- 📊 **Detailed Reports** - See exactly where console statements are, by file and by method
- 🔀 **Git-Aware Filtering** - Filter by author (so you never delete another developer's logs) or uncommitted changes for recent clean up
- 💾 **Automatic Backups** - Creates compressed backups before making changes
- 🔄 **Easy Restore** - Restore from backup if something goes wrong
- 🎨 **Beautiful CLI** - Interactive checkboxes, colored output, progress spinners
- ⚡ **Dry Run Mode** - Preview changes without modifying files
- 🛡️ **Safe by Design** - Handles all edge cases that break regex-based tools

## 📦 Installation

### Global Installation (Recommended)

```bash
npm install -g log-sweep
```

Then use anywhere:

```bash
log-sweep scan
log-sweep remove # you can use 'logsweep' as a short alias
```

### Local Installation

```bash
npm install --save-dev log-sweep
```

Then use via npx:

```bash
npx log-sweep scan
```

Or add to package.json scripts:

```json
{
  "scripts": {
    "console:scan": "log-sweep scan src",
    "console:clean": "log-sweep remove src"
  }
}
```

## 🚀 Quick Start

### Scan your codebase

```bash
# Scan current directory
log-sweep scan

# Scan specific directory
log-sweep scan ./src

# Save results to JSON
log-sweep scan --output results.json

# Scan only YOUR console statements (git blame)
log-sweep scan --git-mine

# Scan only uncommitted changes
log-sweep scan --git-uncommitted

# Combine filters: only YOUR uncommitted console statements
log-sweep scan --git-mine --git-uncommitted
```

### Remove console statements (Interactive)

```bash
# Interactive removal with backup
log-sweep remove

# Remove from specific directory
log-sweep remove ./src

# Dry run (preview only)
log-sweep remove --dry-run

# Skip backup (not recommended)
log-sweep remove --no-backup

# Remove only YOUR console statements (safe for teams!)
log-sweep remove --git-mine

# Remove only from uncommitted changes
log-sweep remove --git-uncommitted

# Combine: remove only YOUR uncommitted console statements
log-sweep remove --git-mine --git-uncommitted
```

### Restore from backup

```bash
log-sweep restore /tmp/log-sweep-backup-2024-01-15.tar.gz
```

## 📚 Commands

### `scan [directory]`

Scan directory for console statements and display detailed report.

**Options:**
- `-e, --exclude <patterns...>` - Exclude directories (default: node_modules, .git, dist, build)
- `-o, --output <file>` - Save results to JSON file
- `--git-mine` - Only show console statements authored by you (uses git blame)
- `--git-uncommitted` - Only show console statements in uncommitted changes

**Examples:**

```bash
# Basic scan
log-sweep scan

# Scan with exclusions
log-sweep scan --exclude test coverage docs

# Save report
log-sweep scan --output console-report.json

# Team-safe: scan only YOUR console statements
log-sweep scan --git-mine

# Pre-commit: scan uncommitted changes
log-sweep scan --git-uncommitted
```

### `remove [directory]`

Interactively remove console statements with AST-based safety.

**Options:**
- `-e, --exclude <patterns...>` - Exclude directories
- `--no-backup` - Skip creating backup
- `--dry-run` - Preview changes without applying
- `--git-mine` - Only remove console statements authored by you (uses git blame)
- `--git-uncommitted` - Only remove console statements in uncommitted changes

**Examples:**

```bash
# Interactive removal (recommended)
log-sweep remove

# Dry run to preview
log-sweep remove --dry-run

# Remove without backup (use with caution)
log-sweep remove --no-backup

# Team-safe: remove only YOUR console statements
log-sweep remove --git-mine

# Pre-commit: remove from uncommitted changes only
log-sweep remove --git-uncommitted

# Safest: remove only YOUR uncommitted statements
log-sweep remove --git-mine --git-uncommitted
```

**Interactive Flow:**

1. Scans your codebase
2. Shows summary of console statements by type
3. Lets you select which methods to remove (checkboxes)
4. Shows preview of what will be changed
5. Asks for confirmation
6. Creates backup (default)
7. Removes selected console statements
8. Displays summary and backup location

### `restore [backupFile]`

Restore files from a backup archive.

**Example:**

```bash
log-sweep restore /tmp/log-sweep-backup-2024-01-15.tar.gz
```

## 👥 Team-Friendly Git Integration

Working on a team? log-sweep has you covered with git-aware filtering:

### Filter by Author (`--git-mine`)

Use `git blame` to only scan/remove console statements **you** wrote:

```bash
# See only YOUR console statements
log-sweep scan --git-mine

# Remove only YOUR console statements (safe for shared codebases!)
log-sweep remove --git-mine
```

**Perfect for:**
- Cleaning up your own debug logs without touching teammates' code
- Team codebases where console.log might be intentional logging
- Code reviews - clean up before committing

### Filter by Uncommitted Changes (`--git-uncommitted`)

Only scan/remove console statements in uncommitted changes:

```bash
# See console statements in uncommitted files
log-sweep scan --git-uncommitted

# Pre-commit cleanup - remove from uncommitted changes only
log-sweep remove --git-uncommitted
```

**Perfect for:**
- Pre-commit hooks
- Quick cleanup before committing
- Avoiding changes to committed/pushed code

### Combine Both for Maximum Safety

```bash
# Only YOUR console statements in YOUR uncommitted changes
log-sweep remove --git-mine --git-uncommitted
```

This ensures you **never accidentally remove a teammate's console statement**.

## 🎯 Why AST-Based?

Regex-based tools break on these edge cases:

```javascript
// ❌ Regex breaks: parentheses in strings
console.log("This has ) parens ( in it", data);

// ❌ Regex breaks: template literals
console.log(`Value: ${func(a, b)} and more`, obj);

// ❌ Regex breaks: nested expressions
console.log("Result:", array.filter(x => (x > 0)).map(y => ({id: y})));

// ❌ Regex breaks: regex patterns
console.log("Test:", /\(.*\)/.test(str));
```

**log-sweep handles ALL of these correctly** because it understands JavaScript syntax using Babel's AST parser.

## 📊 Example Output

### Scan Results

```
🔍 Console Statement Scanner

✓ Scan complete!

📊 Scan Results:

Total console statements: 287
Files with console statements: 45

📋 By Method:

  log      :  186 occurrences
  error    :   54 occurrences
  warn     :   32 occurrences
  info     :   12 occurrences
  debug    :    3 occurrences

📁 Top Files:

   1. src/utils/logger.js (34)
   2. src/services/api.js (28)
   3. src/components/App.jsx (19)
  ... and 42 more files
```

### Interactive Removal

```
🧹 Console Statement Remover

✓ Scan complete!

📋 Select console methods to remove:

? Which console methods should be removed?
  ◉ log      - 186 occurrences
  ◯ error    - 54 occurrences
  ◉ warn     - 32 occurrences
  ◉ info     - 12 occurrences
  ◉ debug    - 3 occurrences

? Would you like to preview changes before applying? (Y/n)

📄 Preview of changes:

Files to modify: 43
Statements to remove: 233
Methods: log, warn, info, debug

  • src/utils/logger.js (28 statements)
  • src/services/api.js (24 statements)
  ... and 41 more files

⚠️  This will modify your files. Continue? (y/N)

✓ Backup created: /tmp/log-sweep-backup-2024-01-15.tar.gz
✓ Successfully removed 233 console statements!

💡 To restore, run: log-sweep restore /tmp/log-sweep-backup-2024-01-15.tar.gz
```

## 🛡️ Safety Features

1. **AST Parsing** - Understands JavaScript syntax perfectly
2. **Git-Aware Filtering** - Filter by author or uncommitted changes (team-safe!)
3. **Automatic Backups** - Compressed tar.gz backups before changes
4. **Dry Run Mode** - Preview without modifying
5. **Confirmation Prompts** - Never surprises you
6. **Error Recovery** - Auto-restores backup on failure
7. **Selective Removal** - Only removes what you choose
8. **Handles Edge Cases** - Strings, regex, templates, nested code

## 🎨 Supported Console Methods

- `console.log`
- `console.warn`
- `console.info`
- `console.debug`
- `console.error`
- `console.trace`
- `console.table`
- `console.dir`
- `console.dirxml`
- `console.assert`
- `console.count`
- `console.time`
- `console.timeEnd`

## 🧪 Supported File Types

- JavaScript (`.js`, `.mjs`, `.cjs`)
- JSX (`.jsx`)
- TypeScript (`.ts`)
- TSX (`.tsx`)

## ⚙️ Configuration

### Excluding Directories

By default, these directories are excluded:
- `node_modules/`
- `.git/`
- `dist/`
- `build/`
- `*.min.js` files

Add custom exclusions:

```bash
log-sweep scan --exclude test coverage docs __tests__
```

### Environment Variables

- `DEBUG=1` - Show detailed error messages and stack traces

```bash
DEBUG=1 log-sweep scan
```

## 🤝 Integration with Build Tools

### NPM Scripts

```json
{
  "scripts": {
    "prebuild": "log-sweep remove src --no-backup",
    "analyze": "log-sweep scan src --output console-report.json"
  }
}
```

### CI/CD

Fail build if console statements are found:

```bash
#!/bin/bash
log-sweep scan src --output report.json
count=$(node -e "console.log(require('./report.json').totalCount)")
if [ "$count" -gt 0 ]; then
  echo "❌ Found $count console statements!"
  exit 1
fi
```

## 📝 License

MIT

## 🐛 Troubleshooting

### Parse Errors

If you get parse errors on specific files:

```bash
# Exclude problematic files
log-sweep scan --exclude problematic-folder

# Enable debug mode
DEBUG=1 log-sweep scan
```

### Backup Restore

If something goes wrong:

```bash
# Find your backup
ls -lt /tmp/log-sweep-backup-*.tar.gz | head -1

# Restore
log-sweep restore /tmp/log-sweep-backup-XXXXX.tar.gz
```

## 🚀 Advanced Usage

### Programmatic API

```javascript
const { scanDirectory } = require('log-sweep/src/scanner');
const { removeConsoleStatements } = require('log-sweep/src/remover');

// Scan
const results = await scanDirectory('./src', ['test', 'coverage']);
console.log(`Found ${results.totalCount} console statements`);

// Remove
const removed = await removeConsoleStatements(
  ['./src/file1.js', './src/file2.js'],
  ['log', 'warn'],
  false // dryRun
);
console.log(`Removed ${removed} statements`);
```

## 🎯 Best Practices

1. ✅ **Always use dry run first** - `--dry-run` to preview
2. ✅ **Keep backups enabled** - They're automatic and compressed
3. ✅ **Keep console.error** - Uncheck 'error' in interactive mode
4. ✅ **Review git diff** - Always check changes before committing
5. ✅ **Run in CI/CD** - Prevent console statements from reaching production

---

**Made with ❤️ for developers who want clean, production-ready code**

