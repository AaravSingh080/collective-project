// Bundles public/ into one self-contained HTML file with the fonts embedded.
//   kiosk/booth.html          open it in Chrome on the booth PC: no install, works offline
//   dist/booth-fragment.html  the same page without the document skeleton, for previews
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');

const fonts = read('fonts.css').replace(/url\(fonts\/([^)]+)\)/g, (_, file) =>
  `url(data:font/woff2;base64,${fs.readFileSync(path.join(pub, 'fonts', file)).toString('base64')})`);

// Function replacements: file contents go in verbatim ($' or $& in a library would otherwise expand).
const inline = (tag, content) => (doc) => doc.replace(tag, () => content);
let html = [
  inline('<link rel="stylesheet" href="fonts.css">', `<style>\n${fonts}\n</style>`),
  inline('<link rel="stylesheet" href="styles.css">', `<style>\n${read('styles.css')}\n</style>`),
  inline('<script src="vendor/qrcode.js"></script>', `<script>\n${read('vendor/qrcode.js')}\n</script>`),
  inline('<script src="vendor/gifenc.js"></script>', `<script>\n${read('vendor/gifenc.js')}\n</script>`),
  inline('<script src="app.js"></script>', `<script>\n${read('app.js')}\n</script>`)
].reduce((doc, step) => step(doc), read('index.html'));
for (const ref of ['fonts.css', 'styles.css', 'vendor/qrcode.js', 'vendor/gifenc.js', 'app.js']) {
  if (html.includes(`"${ref}"`)) throw new Error(`${ref} was not inlined`);
}

for (const dir of ['kiosk', 'dist']) fs.mkdirSync(path.join(root, dir), { recursive: true });
fs.writeFileSync(path.join(root, 'kiosk', 'booth.html'), html);

const body = html
  .replace(/^[\s\S]*?<head>/, '')
  .replace(/<\/head>\s*<body>/, '')
  .replace(/<meta[^>]*>\s*/g, '')
  .replace(/<\/body>\s*<\/html>\s*$/, '');
fs.writeFileSync(path.join(root, 'dist', 'booth-fragment.html'), body);
console.log(`wrote kiosk/booth.html (${(html.length / 1024).toFixed(0)} KB) and dist/booth-fragment.html`);
