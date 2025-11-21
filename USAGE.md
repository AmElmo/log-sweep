# log-sweep - Quick Start Guide

## 🚀 Installation

```bash
cd log-sweep
npm install
```

## 📖 Usage

### 1. Scan Mode (Read-Only)

See what console statements exist in your codebase:

```bash
# Scan current directory
node src/cli.js scan

# Scan specific directory
node src/cli.js scan ../extension

# Save results to JSON
node src/cli.js scan ../extension --output report.json

# Exclude additional directories
node src/cli.js scan ../extension --exclude test __tests__ coverage
```

**Output shows:**
- Total count of console statements
- Breakdown by method (log, warn, error, etc.)
- Top 10 files with most console statements

### 2. Remove Mode (Interactive)

Interactively select and remove console statements:

```bash
# Interactive removal with all safety features
node src/cli.js remove ../extension

# Dry run (preview only, no changes)
node src/cli.js remove ../extension --dry-run

# Remove without backup (not recommended)
node src/cli.js remove ../extension --no-backup
```

**Interactive flow:**
1. Scans your code
2. Shows summary
3. **Interactive checkbox selection** - choose which methods to remove
4. Preview of changes
5. Confirmation prompt
6. Creates backup (automatic)
7. Removes selected statements
8. Shows summary and backup location

### 3. Restore Mode

Undo changes by restoring from backup:

```bash
node src/cli.js restore /tmp/log-sweep-backup-XXXXX.tar.gz
```

## 🎯 Real-World Example

Let's say you want to remove all debug logs but keep errors and warnings:

```bash
$ node src/cli.js remove ../extension

🔍 Console Statement Scanner
✔ Scan complete!

📊 Scan Results:
Total console statements: 572
Files with console statements: 22

📋 By Method:
  log      :  326 occurrences
  error    :  181 occurrences
  warn     :   65 occurrences

📋 Select console methods to remove:

? Which console methods should be removed?
  ◉ log      - 326 occurrences
  ◯ error    - 181 occurrences  ← UNCHECK THIS (keep errors)
  ◯ warn     - 65 occurrences   ← UNCHECK THIS (keep warnings)

? Would you like to preview changes before applying? Yes

📄 Preview of changes:
Files to modify: 18
Statements to remove: 326
Methods: log

⚠️  This will modify your files. Continue? Yes

✔ Backup created: /tmp/log-sweep-backup-2024-01-15.tar.gz
✔ Successfully removed 326 console statements!

💡 To restore: node src/cli.js restore /tmp/log-sweep-backup-XXXXX.tar.gz
```

## 🛡️ Safety Features

1. **AST-Based** - Understands JavaScript perfectly, handles all edge cases
2. **Auto Backup** - Creates compressed backup before changes
3. **Dry Run** - Test without making changes
4. **Interactive** - Choose exactly what to remove
5. **Confirmation** - Never surprises you
6. **Restore** - Easy undo if needed

## 🎨 Supported Console Methods

The tool detects and can remove:
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

## 📦 Publishing to NPM (Optional)

To make it globally available:

1. Update package.json (name, author, version)
2. Create npm account: https://www.npmjs.com/signup
3. Login: `npm login`
4. Publish: `npm publish`

Then anyone can use:

```bash
npm install -g log-sweep
log-sweep scan
```

## 🔧 Troubleshooting

### "Parse error" on some files

Some files might have syntax errors or use very new JS features. The tool will skip these and continue:

```bash
# Enable debug mode to see which files are skipped
DEBUG=1 node src/cli.js scan ../extension
```

### glob pattern not matching

The tool looks for: `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs` files.

It automatically excludes:
- `node_modules/`
- `.git/`
- `dist/`
- `build/`
- `*.min.js`

### Need to restore

```bash
# Find your most recent backup
ls -lt /tmp/log-sweep-backup-*.tar.gz | head -1

# Restore it
node src/cli.js restore /tmp/log-sweep-backup-XXXXX.tar.gz
```

## 💡 Pro Tips

1. **Always use dry-run first** to preview changes
2. **Keep console.error** - Uncheck it in the interactive prompt
3. **Run scan before remove** to understand what you have
4. **Check git diff after** to verify changes
5. **Backups are your friend** - They're automatic, use them!

## 🎯 Why This Tool?

**Compared to regex-based tools:**

✅ Handles parentheses in strings  
✅ Handles template literals  
✅ Handles nested expressions  
✅ Handles regex patterns  
✅ Handles all JavaScript edge cases  

**Compared to build tools:**

✅ Interactive selection  
✅ Preview mode  
✅ Source code modification (not just build output)  
✅ Works without build setup  

---

**Need help?** Check the README.md for full documentation!

