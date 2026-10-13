// Bundles public/ into one self-contained HTML file (dist/booth.html).
// Useful for a quick design preview or hosting without the server (print is then simulated).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
let html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');

html = html.replace('<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`);
html = html.replace('<script src="app.js"></script>', `<script>\n${js}\n</script>`);

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'booth.html'), html);

// Artifact flavour: body-only fragment (the publisher wraps it in its own skeleton).
const body = html
  .replace(/^[\s\S]*?<head>/, '')
  .replace(/<\/head>\s*<body>/, '')
  .replace(/<meta[^>]*>\s*/g, '')
  .replace(/<\/body>\s*<\/html>\s*$/, '');
fs.writeFileSync(path.join(outDir, 'booth-fragment.html'), body);
console.log('wrote dist/booth.html and dist/booth-fragment.html');
