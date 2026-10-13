// THE COLLECTIVE photo booth — print server.
// Serves the kiosk UI from /public and turns captured photos into 4x6 prints.
//
//   POST /api/print      { image: "data:image/png;base64,...", copies?: 1 }
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
fs.mkdirSync(PRINTS_DIR, { recursive: true });

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
      autoPrint: config.autoPrint,
      copies: config.copies,
      defaultFilter: config.defaultFilter,
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
});
