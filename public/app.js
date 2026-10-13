/* THE COLLECTIVE photo booth — kiosk logic.
   Stages: attract -> countdown -> review -> printing -> done | error
   Talks to server.js (/api/status, /api/print). If no server answers (e.g. the design
   preview), it runs in demo mode: everything works, "Print" is simulated. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const booth = $('booth'), video = $('video'), flash = $('flash');
  const printCanvas = $('printCanvas');

  // ---------- defaults (overridden by /api/status) ----------
  const state = {
    cfg: {
      storeName: 'Palladium, Mumbai', eventName: '', hashtag: '#TheCollectiveIndia',
      shots: 1, countdownSeconds: 3, autoPrint: false, copies: 1,
      mirrorPreview: true, mirrorPrint: false, idleResetSeconds: 45,
      paper: { widthIn: 4, heightIn: 6, dpi: 300 }
    },
    server: null,          // /api/status payload or null => demo
    stream: null,
    cameraLabel: '',
    shots: [],             // captured ImageBitmap/canvas list
    copies: 1,
    busy: false,
    idleTimer: null,
    uploaded: null         // user-chosen photo when no camera is available
  };

  // ---------- rails text ----------
  const railText = Array(24).fill('The Collective').join(' · ') + ' · ';
  document.querySelectorAll('.rail span').forEach(s => s.textContent = railText + railText);

  // ---------- stage control ----------
  function setStage(name) {
    booth.dataset.stage = name;
    armIdle(name);
  }
  function armIdle(stage) {
    clearTimeout(state.idleTimer);
    if (stage === 'attract' || stage === 'countdown' || stage === 'printing') return;
    state.idleTimer = setTimeout(() => goHome(), state.cfg.idleResetSeconds * 1000);
  }
  function goHome() {
    state.shots = [];
    state.copies = state.cfg.copies || 1;
    $('copiesN').textContent = state.copies;
    setStage('attract');
  }

  // ---------- status chip ----------
  function status(text, level) {
    $('statusText').textContent = text;
    $('status').className = 'status ' + (level || '');
  }

  // ---------- server ----------
  async function loadStatus() {
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.statusText);
      const s = await r.json();
      state.server = s;
      Object.assign(state.cfg, s.config || {});
      if (s.mode === 'dry-run') status('Dry run · saving, not printing', 'warn');
      else if (s.printer) status(`Printer · ${s.printer}`, 'ok');
      else status('No printer found', 'bad');
      $('adminServer').textContent = `${s.platform} · ${s.mode}`;
      $('adminPrinter').textContent = s.printer || (s.printerError || 'none detected');
    } catch {
      state.server = null;
      status('Demo · print is simulated', 'warn');
      $('adminServer').textContent = 'not connected (demo)';
      $('adminPrinter').textContent = 'simulated';
    }
    applyConfig();
  }
  function applyConfig() {
    const c = state.cfg;
    $('storeLabel').textContent = c.eventName || c.storeName;
    $('doneHint').textContent = c.hashtag ? `Share it with ${c.hashtag}` : 'Thank you for visiting The Collective';
    $('shotsSelect').value = String(c.shots);
    $('mirrorChk').checked = !!c.mirrorPreview;
    booth.classList.toggle('mirror', !!c.mirrorPreview);
    state.copies = c.copies || 1;
    $('copiesN').textContent = state.copies;
    $('attractHint').textContent = c.shots > 1
      ? `${c.shots} shots on one 4 × 6 inch print, framed by The Collective.`
      : 'A 4 × 6 inch print, framed by The Collective.';
  }

  // ---------- camera ----------
  async function startCamera(deviceId) {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) return cameraUnavailable('Camera API not available');
    const constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } }
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      state.stream = stream;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const track = stream.getVideoTracks()[0];
      state.cameraLabel = track?.label || 'camera';
      const s = track?.getSettings?.() || {};
      $('adminCamera').textContent = `${state.cameraLabel} ${s.width ? `· ${s.width}×${s.height}` : ''}`;
      video.hidden = false;
      await listCameras(track?.getSettings?.().deviceId);
    } catch (err) {
      cameraUnavailable(err.message || String(err));
    }
  }
  function stopCamera() {
    if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
  }
  function cameraUnavailable(reason) {
    state.cameraLabel = '';
    $('adminCamera').textContent = `unavailable · ${reason}`;
    video.hidden = true;
    $('upload').hidden = false;
    if (!state.server) status('Demo · camera blocked here, using a sample portrait', 'warn');
    else status(`Camera unavailable · ${reason}`, 'bad');
  }
  $('uploadInput').addEventListener('change', (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      state.uploaded = c; URL.revokeObjectURL(img.src);
      $('uploadLabel').textContent = 'Photo loaded · tap to begin';
      status('Using your photo for the print', 'ok');
    };
    img.src = URL.createObjectURL(file);
  });
  async function listCameras(currentId) {
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      const sel = $('cameraSelect');
      sel.innerHTML = '';
      devs.forEach((d, i) => {
        const o = document.createElement('option');
        o.value = d.deviceId; o.textContent = d.label || `Camera ${i + 1}`;
        if (d.deviceId === currentId) o.selected = true;
        sel.appendChild(o);
      });
    } catch {}
  }

  // Grab the current frame as a canvas (or a drawn sample when no camera).
  function grabFrame() {
    const c = document.createElement('canvas');
    if (!state.stream && state.uploaded) return state.uploaded;
    if (state.stream && video.videoWidth) {
      c.width = video.videoWidth; c.height = video.videoHeight;
      const ctx = c.getContext('2d');
      if (state.cfg.mirrorPrint) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, 0, 0);
      return c;
    }
    return sampleFrame();
  }
  // A deliberately abstract stand-in: studio backdrop, soft key light, a silhouette. Used only
  // when no camera is available (design preview), so the full flow and print layout can be seen.
  function sampleFrame() {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 900;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, 900);
    bg.addColorStop(0, '#2a2622'); bg.addColorStop(1, '#0f0d0b');
    g.fillStyle = bg; g.fillRect(0, 0, 1600, 900);
    const key = g.createRadialGradient(1050, 250, 40, 1050, 250, 900);
    key.addColorStop(0, 'rgba(217,187,134,.55)'); key.addColorStop(1, 'rgba(217,187,134,0)');
    g.fillStyle = key; g.fillRect(0, 0, 1600, 900);
    // floor line + shadow
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(800, 905, 420, 60, 0, 0, Math.PI * 2); g.fill();
    // silhouette: shoulders + head
    g.fillStyle = '#060504';
    g.beginPath(); g.moveTo(420, 900); g.bezierCurveTo(470, 640, 640, 560, 800, 560);
    g.bezierCurveTo(960, 560, 1130, 640, 1180, 900); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(800, 400, 150, 185, 0, 0, Math.PI * 2); g.fill();
    // rim light
    g.strokeStyle = 'rgba(217,187,134,.45)'; g.lineWidth = 6;
    g.beginPath(); g.ellipse(800, 400, 150, 185, 0, -Math.PI * .55, Math.PI * .05); g.stroke();
    g.font = '500 28px Jost, sans-serif'; g.fillStyle = 'rgba(243,238,228,.5)'; g.textAlign = 'center';
    g.letterSpacing = '0.3em';
    g.fillText('SAMPLE FRAME · CAMERA NOT AVAILABLE HERE', 800, 860);
    return c;
  }

  // ---------- capture sequence ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  async function captureSequence() {
    if (state.busy) return;
    state.busy = true;
    state.shots = [];
    const total = state.cfg.shots || 1;
    setStage('countdown');
    for (let i = 0; i < total; i++) {
      $('shotLabel').textContent = total > 1 ? `Shot ${i + 1} of ${total}` : 'Get ready';
      for (let n = state.cfg.countdownSeconds; n >= 1; n--) {
        const el = $('countNum');
        el.textContent = n; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
        await sleep(1000);
      }
      flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
      state.shots.push(grabFrame());
      $('countNum').textContent = '✓';
      await sleep(total > 1 ? 1100 : 500);
    }
    await compose(printCanvas, state.shots);
    state.busy = false;
    setStage('review');
    if (state.cfg.autoPrint) { $('autoNote').hidden = false; await sleep(1800); doPrint(); }
    else $('autoNote').hidden = true;
  }

  // ---------- the print: 4x6 in at 300 dpi, branding all around ----------
  async function compose(canvas, frames) {
    const { widthIn, heightIn, dpi } = state.cfg.paper;
    const W = Math.round(widthIn * dpi), H = Math.round(heightIn * dpi);
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const u = W / 1200; // scale unit so the layout holds for any paper size

    try { await Promise.all([
      document.fonts.load(`500 ${80 * u}px "Bodoni Moda"`),
      document.fonts.load(`italic 400 ${30 * u}px "Bodoni Moda"`),
      document.fonts.load(`400 ${20 * u}px Jost`)
    ]); } catch {}
    const SERIF = '"Bodoni Moda", Didot, "Playfair Display", Georgia, serif';
    const SANS = 'Jost, Futura, "Helvetica Neue", Arial, sans-serif';
    const INK = '#0b0a09', IVORY = '#f5f1e8', BRONZE = '#a8824c', BRONZE_SOFT = '#cdb282';

    // paper
    g.fillStyle = IVORY; g.fillRect(0, 0, W, H);

    // --- running wordmark border on all four sides (the "all around" branding) ---
    const edge = 22 * u;                           // bleed-safe inset
    const railH = 34 * u;
    g.save();
    g.fillStyle = INK;
    g.fillRect(0, 0, W, edge + railH);             // top band
    g.fillRect(0, H - edge - railH, W, edge + railH); // bottom band
    g.fillRect(0, 0, edge + railH, H);             // left band
    g.fillRect(W - edge - railH, 0, edge + railH, H); // right band
    g.fillStyle = BRONZE_SOFT;
    g.font = `500 ${13 * u}px ${SERIF}`;
    g.letterSpacing = `${4 * u}px`;
    g.textBaseline = 'middle';
    const word = 'THE COLLECTIVE   ·   ';
    const ww = g.measureText(word).width;
    const drawRun = (len) => { for (let x = -ww * .3; x < len; x += ww) g.fillText(word, x, 0); };
    g.textAlign = 'left';
    g.save(); g.translate(edge + railH, edge + railH / 2); drawRun(W - 2 * (edge + railH)); g.restore();
    g.save(); g.translate(W - edge - railH, H - edge - railH / 2); g.rotate(Math.PI); drawRun(W - 2 * (edge + railH)); g.restore();
    g.save(); g.translate(edge + railH / 2, H - edge - railH); g.rotate(-Math.PI / 2); drawRun(H - 2 * (edge + railH)); g.restore();
    g.save(); g.translate(W - edge - railH / 2, edge + railH); g.rotate(Math.PI / 2); drawRun(H - 2 * (edge + railH)); g.restore();
    // corner monograms on clean squares
    const cs = edge + railH;
    g.fillStyle = INK;
    [[0, 0], [W - cs, 0], [0, H - cs], [W - cs, H - cs]].forEach(([x, y]) => g.fillRect(x, y, cs, cs));
    g.fillStyle = BRONZE_SOFT;
    g.font = `italic 400 ${18 * u}px ${SERIF}`; g.letterSpacing = '0px'; g.textAlign = 'center';
    const cx = edge + railH / 2, cy = edge + railH / 2;
    [[cx, cy], [W - cx, cy], [cx, H - cy], [W - cx, H - cy]].forEach(([x, y]) => g.fillText('C', x, y + 1 * u));
    g.restore();

    // inner hairlines
    const inner = edge + railH;                    // 56u
    g.strokeStyle = BRONZE; g.lineWidth = 1.5 * u;
    g.strokeRect(inner + 12 * u, inner + 12 * u, W - 2 * (inner + 12 * u), H - 2 * (inner + 12 * u));

    // --- header ---
    const left = inner + 12 * u, right = W - left;
    const contentW = right - left;
    g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = `italic 400 ${30 * u}px ${SERIF}`; g.letterSpacing = `${1 * u}px`;
    g.fillStyle = BRONZE; g.fillText('The', W / 2, inner + 78 * u);
    g.font = `500 ${86 * u}px ${SERIF}`; g.letterSpacing = `${28 * u}px`;
    g.fillStyle = INK; g.fillText('COLLECTIVE', W / 2 + 14 * u, inner + 160 * u);
    g.font = `400 ${15 * u}px ${SANS}`; g.letterSpacing = `${6 * u}px`; g.fillStyle = BRONZE;
    g.fillText("INDIA'S LARGEST LUXURY MULTI-BRAND RETAILER", W / 2 + 3 * u, inner + 198 * u);
    // short rule
    g.fillStyle = BRONZE; g.fillRect(W / 2 - 40 * u, inner + 218 * u, 80 * u, 1.5 * u);

    // --- footer ---
    const footerTop = H - inner - 150 * u;
    g.fillStyle = BRONZE; g.fillRect(W / 2 - 40 * u, footerTop, 80 * u, 1.5 * u);
    g.fillStyle = INK; g.font = `400 ${26 * u}px ${SERIF}`; g.letterSpacing = `${2 * u}px`;
    g.fillText(state.cfg.eventName || state.cfg.storeName, W / 2, footerTop + 48 * u);
    const d = new Date();
    const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
    g.font = `400 ${14 * u}px ${SANS}`; g.letterSpacing = `${5 * u}px`; g.fillStyle = '#5d564b';
    g.fillText(dateStr, W / 2 + 2 * u, footerTop + 82 * u);
    g.fillStyle = BRONZE; g.font = `400 ${15 * u}px ${SANS}`; g.letterSpacing = `${3 * u}px`;
    g.fillText(state.cfg.hashtag || 'THECOLLECTIVE.IN', W / 2 + 1 * u, footerTop + 116 * u);

    // --- photos ---
    const top = inner + 248 * u, bottom = footerTop - 28 * u;
    const gap = 18 * u;
    const n = frames.length;
    let slotH = (bottom - top - gap * (n - 1)) / n;
    let slotW = contentW - 24 * u;
    // single shot: fill the width in 4:3 (webcam-friendly); strip: keep 16:9 rows
    const ratio = n === 1 ? 5 / 4 : 16 / 9;
    if (slotW / slotH > ratio) slotW = slotH * ratio; else slotH = slotW / ratio;
    const x0 = (W - slotW) / 2;
    let y = n === 1 ? top + (bottom - top - slotH) / 2 : top + (bottom - top - (slotH * n + gap * (n - 1))) / 2;
    frames.forEach((f) => {
      drawCover(g, f, x0, y, slotW, slotH);
      g.strokeStyle = INK; g.lineWidth = 2 * u; g.strokeRect(x0, y, slotW, slotH);
      // thin bronze offset line, like a mat
      g.strokeStyle = BRONZE; g.lineWidth = 1 * u; g.strokeRect(x0 - 8 * u, y - 8 * u, slotW + 16 * u, slotH + 16 * u);
      y += slotH + gap;
    });
  }
  function drawCover(g, img, x, y, w, h) {
    const iw = img.width, ih = img.height, r = Math.max(w / iw, h / ih);
    const sw = w / r, sh = h / r, sx = (iw - sw) / 2, sy = (ih - sh) / 2;
    g.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  // ---------- print ----------
  async function doPrint() {
    if (state.busy) return;
    state.busy = true;
    setStage('printing');
    const dataUrl = printCanvas.toDataURL('image/png');
    try {
      if (state.server) {
        const r = await fetch('/api/print', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl, copies: state.copies })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || r.statusText);
        if (j.mode === 'dry-run') status(`Dry run · saved ${j.file}`, 'warn');
      } else {
        await sleep(2200); // demo
      }
      state.busy = false;
      setStage('done');
      setTimeout(() => { if (booth.dataset.stage === 'done') goHome(); }, 9000);
    } catch (err) {
      state.busy = false;
      $('errorHint').textContent = err.message || String(err);
      setStage('error');
    }
  }

  // ---------- admin ----------
  let tapCount = 0, tapTimer;
  $('adminBtn').addEventListener('click', () => {
    tapCount++; clearTimeout(tapTimer);
    tapTimer = setTimeout(() => tapCount = 0, 1600);
    if (tapCount >= 5) { tapCount = 0; $('admin').hidden = false; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('admin').hidden = !$('admin').hidden; }
    if (e.key === ' ' && booth.dataset.stage === 'attract') { e.preventDefault(); captureSequence(); }
    if (e.key === 'Enter' && booth.dataset.stage === 'review') doPrint();
    if (e.key === 'Escape') goHome();
  });
  $('adminClose').addEventListener('click', () => $('admin').hidden = true);
  $('cameraSelect').addEventListener('change', (e) => startCamera(e.target.value));
  $('shotsSelect').addEventListener('change', (e) => { state.cfg.shots = Number(e.target.value); applyConfig(); });
  $('mirrorChk').addEventListener('change', (e) => { state.cfg.mirrorPreview = e.target.checked; booth.classList.toggle('mirror', e.target.checked); });
  $('fullscreenBtn').addEventListener('click', () => document.documentElement.requestFullscreen?.().catch(() => {}));
  $('testPrintBtn').addEventListener('click', async () => {
    $('admin').hidden = true;
    state.shots = Array.from({ length: state.cfg.shots || 1 }, () => grabFrame());
    await compose(printCanvas, state.shots);
    doPrint();
  });

  // ---------- wiring ----------
  $('startBtn').addEventListener('click', captureSequence);
  $('printBtn').addEventListener('click', doPrint);
  $('retakeBtn').addEventListener('click', captureSequence);
  $('againBtn').addEventListener('click', goHome);
  $('retryBtn').addEventListener('click', doPrint);
  $('errorHomeBtn').addEventListener('click', goHome);
  document.querySelectorAll('.copies-btn').forEach(b => b.addEventListener('click', () => {
    state.copies = Math.min(5, Math.max(1, state.copies + Number(b.dataset.delta)));
    $('copiesN').textContent = state.copies;
    b.parentElement.querySelector('.copies-n').lastChild.textContent = state.copies === 1 ? ' copy' : ' copies';
    armIdle('review');
  }));
  document.addEventListener('pointerdown', () => armIdle(booth.dataset.stage), { passive: true });

  (async () => {
    await loadStatus();
    await startCamera();
    // pre-render a preview so the review stage never shows an empty sheet
    compose(printCanvas, [sampleFrame()]);
    goHome();
  })();
})();
