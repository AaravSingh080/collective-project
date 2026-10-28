// THE COLLECTIVE photo booth — print server.
// Serves the kiosk UI from /public and turns captured photos into 4x6 prints.
//
//   POST /api/print      { image: "data:image/png;base64,...", copies?: 1 }
//   POST /api/share      { sheet: "data:image/jpeg;base64,...", photo?, no?, place? } -> { url }
//   GET  /p/:id          the guest's download page (opened from the QR code)
//   GET  /api/printers   list printers the OS knows about
//   GET  /api/status     config the kiosk needs + printer readiness
//
// Printing path: PNG -> borderless PDF sized to the paper -> OS print queue.
//   Windows:      pdf-to-printer (bundles SumatraPDF, prints silently)
//   macOS/Linux:  `lp` (CUPS)
// Set DRY_RUN=1 (or printer.dryRun in config.json) to save files without printing.

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');
const PRINTS_DIR = path.join(__dirname, 'prints');

function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  raw.printer = raw.printer || {};
  if (process.env.DRY_RUN === '1') raw.printer.dryRun = true;
  if (process.env.PRINTER) raw.printer.name = process.env.PRINTER;
  if (process.env.PORT) raw.port = Number(process.env.PORT);
  return raw;
}

let config = loadConfig();
const SHARE_DIR = path.join(PRINTS_DIR, 'share');
fs.mkdirSync(SHARE_DIR, { recursive: true });

// ---------- guest downloads over the store network ----------

function lanAddress() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) found.push(n.address);
  }
  return found.find((a) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) || found[0] || null;
}
function shareBase() {
  const fixed = config.share?.baseUrl;
  if (fixed) return fixed.replace(/\/$/, '');
  const ip = lanAddress();
  return ip ? `http://${ip}:${config.port}` : null;
}
const keepDays = () => Math.max(1, Number(config.share?.keepDays) || 7);
const validId = (id) => /^[A-Za-z0-9_-]{12}$/.test(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cleanShares() {
  const cutoff = Date.now() - keepDays() * 864e5;
  for (const f of fs.readdirSync(SHARE_DIR)) {
    const p = path.join(SHARE_DIR, f);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch {}
  }
}
cleanShares();
setInterval(cleanShares, 60 * 60 * 1000).unref();

function sharePage(id, meta) {
  const hasPhoto = fs.existsSync(path.join(SHARE_DIR, `${id}-photo.jpg`));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your portrait · The Collective</title>
<link rel="stylesheet" href="/fonts.css">
<style>
:root{--ink:#000;--grey:#3a3a3a;--bronze:#6e522b;--hair:#d6d6d6;color-scheme:light}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font-family:Manrope,"Segoe UI",Arial,sans-serif;font-weight:500}
main{max-width:520px;margin:0 auto;padding:36px 20px 48px;display:flex;flex-direction:column;align-items:center;gap:22px;text-align:center}
.the{margin:0;font-family:"Bodoni Moda",Georgia,serif;font-style:italic;font-weight:600;font-size:20px;color:var(--bronze)}
.mark{margin:0;font-family:"Bodoni Moda",Georgia,serif;font-weight:600;font-size:30px;letter-spacing:.34em;padding-left:.34em}
.eyebrow{margin:0;font-size:13px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--bronze)}
img{width:100%;height:auto;display:block;box-shadow:0 16px 40px rgba(0,0,0,.14),0 0 0 1px #e4e4e4}
.btn{display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;border-radius:999px;border:1.5px solid var(--ink);text-decoration:none;font-size:15px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}
.solid{background:var(--ink);color:#fff}.line{background:#fff;color:var(--ink)}
.actions{width:100%;display:flex;flex-direction:column;gap:12px}
p.note{margin:0;font-size:15px;line-height:1.55;color:var(--grey)}
footer{font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--grey)}
</style></head><body><main>
<div><p class="the">The</p><p class="mark">COLLECTIVE</p></div>
<p class="eyebrow">Your portrait${meta.no ? ` · ${esc(meta.no)}` : ''}</p>
<img src="/p/${id}/sheet.jpg" alt="Your framed portrait from The Collective">
<div class="actions">
<a class="btn solid" href="/p/${id}/sheet.jpg?dl=1" download>Save framed print</a>
${hasPhoto ? `<a class="btn line" href="/p/${id}/photo.jpg?dl=1" download>Save photo only</a>` : ''}
</div>
<p class="note">On iPhone you can also press and hold the picture, then choose Save to Photos. This link works for ${keepDays()} days.</p>
<footer>The Collective${meta.place ? ` · ${esc(meta.place)}` : ''}</footer>
</main></body></html>`;
}

// ---------- printer backends ----------

const isWindows = process.platform === 'win32';
let winPrinter = null;
if (isWindows) {
  try { winPrinter = await import('pdf-to-printer'); }
  catch (err) { console.warn('pdf-to-printer unavailable:', err.message); }
}

async function listPrinters() {
  if (isWindows) {
    if (!winPrinter) return [];
    const list = await winPrinter.getPrinters();
    let def = null;
    try { def = await winPrinter.getDefaultPrinter(); } catch {}
    return list.map(p => ({
      name: p.name,
      isDefault: !!def && def.name === p.name,
      paperSizes: p.paperSizes || []
    }));
  }
  // CUPS: `lpstat -p -d`
  const out = await run('lpstat', ['-p', '-d']).catch(() => '');
  const names = [...out.matchAll(/^printer (\S+)/gm)].map(m => m[1]);
  const def = (out.match(/system default destination: (\S+)/) || [])[1] || null;
  return names.map(n => ({ name: n, isDefault: n === def, paperSizes: [] }));
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(out) : reject(new Error(err.trim() || `${cmd} exited ${code}`)));
  });
}

async function sendToPrinter(pdfPath, { copies = 1 } = {}) {
  const { name, windowsPaperSize } = config.printer;
  if (isWindows) {
    if (!winPrinter) throw new Error('pdf-to-printer is not installed. Run `npm install`.');
    const opts = { scale: 'fit', silent: true, copies };
    if (name) opts.printer = name;
    const paperSize = windowsPaperSize || config.paper.name;
    if (paperSize) opts.paperSize = paperSize;
    await winPrinter.print(pdfPath, opts);
    return;
  }
  const { widthIn, heightIn, name: paperName } = config.paper;
  const args = [];
  if (name) args.push('-d', name);
  args.push('-n', String(copies));
  args.push('-o', `media=${paperName || `Custom.${widthIn}x${heightIn}in`}`, '-o', 'fit-to-page');
  args.push(pdfPath);
  await run('lp', args);
}

// ---------- PNG -> PDF sized exactly to the paper ----------

function pngToPdf(pngPath, pdfPath) {
  const { widthIn, heightIn } = config.paper;
  const w = widthIn * 72, h = heightIn * 72; // PDF points
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [w, h], margin: 0, autoFirstPage: true });
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);
    doc.image(pngPath, 0, 0, { width: w, height: h });
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ---------- web app ----------

const app = express();
app.use(express.json({ limit: '40mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.post('/api/share', (req, res) => {
  const { sheet, photo, no, place } = req.body || {};
  const isJpeg = (d) => typeof d === 'string' && d.startsWith('data:image/jpeg;base64,');
  if (!isJpeg(sheet)) return res.status(400).json({ error: 'Expected { sheet: "data:image/jpeg;base64,..." }' });
  const base = shareBase();
  if (!base) return res.status(503).json({ error: 'This PC is not on a network, so phones cannot reach it.' });
  const id = crypto.randomBytes(9).toString('base64url');
  try {
    fs.writeFileSync(path.join(SHARE_DIR, `${id}-sheet.jpg`), Buffer.from(sheet.split(',')[1], 'base64'));
    if (isJpeg(photo)) fs.writeFileSync(path.join(SHARE_DIR, `${id}-photo.jpg`), Buffer.from(photo.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(SHARE_DIR, `${id}.json`), JSON.stringify({ no: String(no || '').slice(0, 40), place: String(place || '').slice(0, 80), at: new Date().toISOString() }));
    res.json({ ok: true, id, url: `${base}/p/${id}`, keepDays: keepDays() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/p/:id', (req, res) => {
  const { id } = req.params;
  if (!validId(id) || !fs.existsSync(path.join(SHARE_DIR, `${id}-sheet.jpg`))) {
    return res.status(404).type('html').send('<!doctype html><meta name="viewport" content="width=device-width"><p style="font-family:sans-serif;padding:24px">This photo link has expired. Please ask our team at the booth.</p>');
  }
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(SHARE_DIR, `${id}.json`), 'utf8')); } catch {}
  res.type('html').send(sharePage(id, meta));
});

app.get('/p/:id/:kind.jpg', (req, res) => {
  const { id, kind } = req.params;
  if (!validId(id) || !['sheet', 'photo'].includes(kind)) return res.sendStatus(404);
  const file = path.join(SHARE_DIR, `${id}-${kind}.jpg`);
  if (!fs.existsSync(file)) return res.sendStatus(404);
  if (req.query.dl) return res.download(file, `the-collective-portrait-${kind === 'photo' ? 'photo' : 'print'}.jpg`);
  res.sendFile(file);
});

app.get('/api/status', async (_req, res) => {
  config = loadConfig();
  let printers = [];
  let error = null;
  try { printers = await listPrinters(); } catch (e) { error = e.message; }
  const target = config.printer.name || (printers.find(p => p.isDefault) || printers[0] || {}).name || null;
  res.json({
    ok: true,
    mode: config.printer.dryRun ? 'dry-run' : 'print',
    platform: process.platform,
    printer: target,
    printers,
    printerError: error,
    config: {
      storeName: config.storeName,
      eventName: config.eventName,
      hashtag: config.hashtag,
      shots: config.shots,
      countdownSeconds: config.countdownSeconds,
      timerChoices: config.timerChoices,
      autoPrint: config.autoPrint,
      copies: config.copies,
      defaultFilter: config.defaultFilter,
      share: {
        mode: config.share?.mode || 'auto',
        wifiName: config.share?.wifiName || '',
        lanBase: shareBase(),
        keepDays: keepDays(),
        cloudinary: config.share?.cloudinary || {}
      },
      mirrorPreview: config.mirrorPreview,
      mirrorPrint: config.mirrorPrint,
      idleResetSeconds: config.idleResetSeconds,
      paper: config.paper
    }
  });
});

app.get('/api/printers', async (_req, res) => {
  try { res.json({ printers: await listPrinters() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/print', async (req, res) => {
  const { image, copies } = req.body || {};
  if (typeof image !== 'string' || !image.startsWith('data:image/png;base64,')) {
    return res.status(400).json({ error: 'Expected { image: "data:image/png;base64,..." }' });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = path.join(PRINTS_DIR, `collective-${stamp}`);
  const pngPath = `${base}.png`, pdfPath = `${base}.pdf`;
  try {
    fs.writeFileSync(pngPath, Buffer.from(image.split(',')[1], 'base64'));
    await pngToPdf(pngPath, pdfPath);
    const n = Math.max(1, Math.min(5, Number(copies) || config.copies || 1));
    if (config.printer.dryRun) {
      console.log(`[dry-run] would print ${n}x ${path.basename(pdfPath)}`);
      return res.json({ ok: true, mode: 'dry-run', file: path.basename(pdfPath), copies: n });
    }
    await sendToPrinter(pdfPath, { copies: n });
    console.log(`[print] sent ${n}x ${path.basename(pdfPath)} -> ${config.printer.name || 'default printer'}`);
    res.json({ ok: true, mode: 'print', file: path.basename(pdfPath), copies: n });
  } catch (e) {
    console.error('[print] failed:', e.message);
    res.status(500).json({ error: e.message, file: path.basename(pdfPath) });
  }
});

// ---------- CLI ----------

if (process.argv.includes('--list-printers')) {
  const list = await listPrinters();
  if (!list.length) console.log('No printers found.');
  for (const p of list) console.log(`${p.isDefault ? '* ' : '  '}${p.name}${p.paperSizes.length ? '  [' + p.paperSizes.join(', ') + ']' : ''}`);
  process.exit(0);
}

app.listen(config.port, () => {
  console.log(`THE COLLECTIVE photo booth  ->  http://localhost:${config.port}`);
  console.log(`mode: ${config.printer.dryRun ? 'DRY RUN (files saved to /prints, nothing printed)' : 'PRINT'}  printer: ${config.printer.name || '(system default)'}`);
  console.log(`guest downloads: ${shareBase() || 'off (no network)'}  ·  kept ${keepDays()} days`);
});
