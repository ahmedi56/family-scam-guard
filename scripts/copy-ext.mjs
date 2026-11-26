// Windows-safe replacement for `cp`: copies the extension files into the built folder.
// Usage: node scripts/copy-ext.mjs [outDir]   (default dist-ext)
import { copyFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';

const out = process.argv[2] || 'dist-ext';

mkdirSync(out, { recursive: true });
copyFileSync('extension/manifest.json', `${out}/manifest.json`);
copyFileSync('extension/background.js', `${out}/background.js`);
copyFileSync('extension/content.js', `${out}/content.js`);
copyFileSync('extension/welcome.html', `${out}/welcome.html`);
copyFileSync('src/signals.js', `${out}/signals.js`); // page scanner shares the popup's rules
if (existsSync('public/icons')) cpSync('public/icons', `${out}/icons`, { recursive: true });
console.log(`Extension ready: load the ${out} folder in chrome://extensions`);
