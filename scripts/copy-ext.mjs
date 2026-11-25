// Windows-safe replacement for `cp`: copies the extension files into the built folder.
import { copyFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';

mkdirSync('dist-ext', { recursive: true });
copyFileSync('extension/manifest.json', 'dist-ext/manifest.json');
copyFileSync('extension/background.js', 'dist-ext/background.js');
copyFileSync('extension/content.js', 'dist-ext/content.js');
copyFileSync('extension/welcome.html', 'dist-ext/welcome.html');
copyFileSync('src/signals.js', 'dist-ext/signals.js'); // page scanner shares the popup's rules
if (existsSync('public/icons')) cpSync('public/icons', 'dist-ext/icons', { recursive: true });
console.log('Extension ready: load the dist-ext folder in chrome://extensions');
