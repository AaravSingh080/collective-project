/* THE COLLECTIVE photo booth — kiosk logic.
   Stages: attract -> countdown -> review -> printing -> done | error
   Two ways to print:
   - with server.js running: POST /api/print, the server sends a PDF to the OS print queue;
   - without it (booth.html opened straight in Chrome): window.print() of an A5 sheet.
     Chrome started with --kiosk-printing prints that silently to the default printer. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const booth = $('booth'), frame = $('frame'), video = $('video'), flash = $('flash');
  const printCanvas = $('printCanvas'), still = $('stillCanvas');

  const state = {
    cfg: {
      storeName: 'Jalandhar, Punjab', eventName: '', hashtag: '#TheCollectiveIndia',
      shots: 1, countdownSeconds: 3, timerChoices: [3, 5, 10], autoPrint: false, copies: 1, defaultFilter: 'original',
      share: { mode: 'auto', lanBase: null, keepDays: 7, wifiName: '', cloudinary: {} },
      mirrorPreview: true, mirrorPrint: false, idleResetSeconds: 45,
      paper: { name: 'A5', widthIn: 5.83, heightIn: 8.27, dpi: 300 }
    },
    server: null,
    stream: null,
    uploaded: null,
    shots: [],
    filter: 'original',
    timer: 3,
    mode: 'photo',          // or 'boomerang'
    frames: [],             // boomerang burst, square canvases
    rendered: [],           // the burst with the current finish applied
    loopTimer: null,
    gifBase: null,
    copies: 1,
    busy: false,
    idleTimer: null,
    doneTimer: null,
    run: 0
  };

  // ---------- portrait numbers: every print gets the next one ----------
  function lastNo() {
    try { return Number(localStorage.getItem('booth.portraitNo')) || 0; } catch { return 0; }
  }
  function saveNo(n) { try { localStorage.setItem('booth.portraitNo', String(n)); } catch {} }
  const fmtNo = (n) => `No. ${String(n).padStart(4, '0')}`;

  // ---------- fit the 1920 x 1080 stage to the screen ----------
  function fit() {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    document.documentElement.style.setProperty('--s', String(s));
  }
  window.addEventListener('resize', fit);
  fit();

  // ---------- edges ----------
  const half = Array(10).fill('THE COLLECTIVE\u2002\u00b7\u2002').join('');
  document.querySelectorAll('.rail').forEach((r) => {
    const span = document.createElement('span');
    span.textContent = half + half;
    r.replaceChildren(span);
  });

  // ---------- finishes ----------
  // css: a canvas filter string. fx: extra pixel work for the signature finishes.
  const FINISHES = [
    { id: 'gelatin',  name: 'Gelatin',  tag: 'Darkroom silver', signature: true, css: 'grayscale(1) contrast(1.3) brightness(1.05)', fx: gelatin },
    { id: 'facade',   name: 'Façade',   tag: 'Bronze duotone',  signature: true, css: 'grayscale(1) contrast(1.15)',                fx: facade },
    { id: 'prism',    name: 'Prism',    tag: 'Spectral edge',   signature: true, css: 'saturate(1.12) brightness(1.04)',            fx: prism },
    { id: 'original', name: 'Colour', css: 'none' },
    { id: 'mono',     name: 'Mono',   css: 'grayscale(1) contrast(1.08)' },
    { id: 'noir',     name: 'Noir',   css: 'grayscale(1) contrast(1.4) brightness(.92)' },
    { id: 'warm',     name: 'Warm',   css: 'sepia(.38) saturate(1.15) contrast(1.05)' },
    { id: 'vintage',  name: 'Vintage', css: 'grayscale(1) contrast(1.12)', fx: vintage },
    { id: 'vivid',    name: 'Vivid',  css: 'saturate(1.35) contrast(1.1)' }
  ];
  const finishById = (id) => FINISHES.find((f) => f.id === id) || FINISHES[3];

  // Gelatin: cool silver tone, fine grain, soft vignette.
  function gelatin(g, w, h) {
    const img = g.getImageData(0, 0, w, h), d = img.data;
    let seed = 1337;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    const grain = 22;
    for (let i = 0; i < d.length; i += 4) {
      const n = rnd() * grain;
      const v = d[i] + n;
      d[i] = clamp(v * 0.97);
      d[i + 1] = clamp(v * 0.99 + 1);
      d[i + 2] = clamp(v * 1.03 + 4);
    }
    g.putImageData(img, 0, 0);
    const r = Math.hypot(w, h) / 2;
    const vg = g.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r);
    vg.addColorStop(0, 'rgba(18,24,34,0)');
    vg.addColorStop(1, 'rgba(18,24,34,0.5)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
  }
  // Façade: map luminance from espresso shadows to champagne highlights.
  function facade(g, w, h) {
    const img = g.getImageData(0, 0, w, h), d = img.data;
    const lo = [24, 18, 12], hi = [236, 219, 184];
    for (let i = 0; i < d.length; i += 4) {
      const t = Math.pow(d[i] / 255, 0.95);
      d[i] = lo[0] + (hi[0] - lo[0]) * t;
      d[i + 1] = lo[1] + (hi[1] - lo[1]) * t;
      d[i + 2] = lo[2] + (hi[2] - lo[2]) * t;
    }
    g.putImageData(img, 0, 0);
  }
  // Prism: red and blue split apart towards the edges, plus a faint spectral leak.
  function prism(g, w, h) {
    const src = g.getImageData(0, 0, w, h), out = g.createImageData(w, h);
    const s = src.data, o = out.data, cx = w / 2, max = Math.max(2, Math.round(w * 0.007));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = (x - cx) / cx;
        const shift = Math.round(max * k * Math.abs(k));
        const xr = Math.min(w - 1, Math.max(0, x - shift));
        const xb = Math.min(w - 1, Math.max(0, x + shift));
        const i = (y * w + x) * 4;
        o[i] = s[(y * w + xr) * 4];
        o[i + 1] = s[i + 1];
        o[i + 2] = s[(y * w + xb) * 4 + 2];
        o[i + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0);
    g.save();
    g.globalCompositeOperation = 'screen';
    let lg = g.createLinearGradient(0, 0, w * 0.45, h * 0.3);
    lg.addColorStop(0, 'rgba(255,70,150,0.30)');
    lg.addColorStop(0.45, 'rgba(255,190,70,0.14)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(0, 0, w, h);
    lg = g.createLinearGradient(w, h, w * 0.55, h * 0.7);
    lg.addColorStop(0, 'rgba(70,190,255,0.28)');
    lg.addColorStop(0.5, 'rgba(140,110,255,0.12)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(0, 0, w, h);
    g.restore();
  }
  // Vintage: black and white on faded, old paper. Lifted blacks, heavy clumpy grain,
  // dust, a few hairline scratches and a deep vignette.
  function vintage(g, w, h) {
    const img = g.getImageData(0, 0, w, h), d = img.data;
    const rnd = Math.random;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() + rnd() + rnd() - 1.5) * 70;
      const v = 30 + d[i] * 0.8 + n;
      d[i] = d[i + 1] = d[i + 2] = clamp(v);
    }
    g.putImageData(img, 0, 0);
    // coarse grain: low-res noise scaled up, blended over the fine grain
    const cw = Math.max(8, Math.round(w / 3)), ch = Math.max(8, Math.round(h / 3));
    const nc = document.createElement('canvas'); nc.width = cw; nc.height = ch;
    const ng = nc.getContext('2d'), nd = ng.createImageData(cw, ch);
    for (let i = 0; i < nd.data.length; i += 4) {
      const v = 128 + (rnd() - 0.5) * 200;
      nd.data[i] = nd.data[i + 1] = nd.data[i + 2] = v; nd.data[i + 3] = 255;
    }
    ng.putImageData(nd, 0, 0);
    g.save();
    g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.45;
    g.imageSmoothingEnabled = true; g.drawImage(nc, 0, 0, w, h);
    g.restore();
    // dust and scratches
    const k = w / 1000;
    g.save();
    for (let i = 0; i < 70; i++) {
      g.fillStyle = rnd() < 0.6 ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';
      g.beginPath(); g.arc(rnd() * w, rnd() * h, (0.6 + rnd() * 2.2) * k, 0, Math.PI * 2); g.fill();
    }
    g.lineWidth = Math.max(1, 0.8 * k);
    for (let i = 0; i < 3; i++) {
      const x = rnd() * w;
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.beginPath(); g.moveTo(x, rnd() * h * 0.3); g.lineTo(x + (rnd() - 0.5) * 12 * k, h * (0.6 + rnd() * 0.4)); g.stroke();
    }
    g.restore();
    const r = Math.hypot(w, h) / 2;
    const vg = g.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.62)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
  }
  function clamp(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

  // Crop `src` to w x h (cover) and apply a finish. Returns a canvas.
  function finished(src, w, h, id) {
    const f = finishById(id);
    const c = document.createElement('canvas');
    c.width = Math.round(w); c.height = Math.round(h);
    const g = c.getContext('2d', { willReadFrequently: !!f.fx });
    g.filter = f.css;
    drawCover(g, src, 0, 0, c.width, c.height);
    g.filter = 'none';
    if (f.fx) f.fx(g, c.width, c.height);
    return c;
  }
  function drawCover(g, img, x, y, w, h) {
    const iw = img.videoWidth || img.width, ih = img.videoHeight || img.height;
    const r = Math.max(w / iw, h / ih), sw = w / r, sh = h / r;
    g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  }

  function renderFinishPickers() {
    const sig = $('signature'), cls = $('classic');
    sig.innerHTML = ''; cls.innerHTML = '';
    FINISHES.forEach((f) => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.id = f.id;
      b.setAttribute('aria-pressed', String(f.id === state.filter));
      b.addEventListener('click', () => chooseFinish(f.id));
      if (f.signature) {
        b.className = 'sig';
        const fr = document.createElement('span'); fr.className = 'sig-frame';
        const cv = document.createElement('canvas'); cv.width = 424; cv.height = 424; cv.dataset.thumb = f.id;
        fr.appendChild(cv);
        const tx = document.createElement('span'); tx.className = 'sig-text';
        const nm = document.createElement('span'); nm.className = 'sig-name'; nm.textContent = f.name;
        const tg = document.createElement('span'); tg.className = 'sig-tag'; tg.textContent = f.tag;
        tx.append(nm, tg); b.append(fr, tx); sig.appendChild(b);
      } else {
        b.className = 'chip'; b.textContent = f.name; cls.appendChild(b);
      }
    });
  }
  function paintThumbs() {
    const src = state.shots[0];
    if (!src) return;
    document.querySelectorAll('canvas[data-thumb]').forEach((cv) => {
      const t = finished(src, cv.width, cv.height, cv.dataset.thumb);
      cv.getContext('2d').drawImage(t, 0, 0);
    });
  }
  async function chooseFinish(id) {
    if (state.filter === id) return;
    state.filter = id;
    document.querySelectorAll('#signature button, #classic button')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    if (state.shots.length) await compose(printCanvas, state.shots);
    if (state.mode === 'boomerang') playLoop();
    armIdle('review');
  }

  // ---------- countdown timer ----------
  function defaultTimer() {
    let t = null;
    try { t = Number(localStorage.getItem('booth.timer')); } catch {}
    return (state.cfg.timerChoices || [3, 5, 10]).includes(t) ? t : (state.cfg.countdownSeconds || 3);
  }
  function renderTimer() {
    const box = $('timerOpts'); box.innerHTML = '';
    (state.cfg.timerChoices || [3, 5, 10]).forEach((sec) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'timer-opt'; b.textContent = `${sec} s`;
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(sec === state.timer));
      b.setAttribute('aria-label', `${sec} second timer`);
      b.dataset.sec = String(sec);
      b.addEventListener('click', () => {
        state.timer = sec;
        box.querySelectorAll('.timer-opt').forEach((o) => o.setAttribute('aria-checked', String(o.dataset.sec === String(sec))));
      });
      box.appendChild(b);
    });
  }

  // ---------- photo download QR ----------
  // Cloud (Cloudinary unsigned upload) works on mobile data and without the server.
  // Otherwise the server keeps the photo and phones on the same Wi-Fi open it.
  function cloudCfg() {
    const c = state.cfg.share?.cloudinary || {};
    let name = c.cloudName || '', preset = c.uploadPreset || '';
    try {
      name = localStorage.getItem('booth.cloudName') || name;
      preset = localStorage.getItem('booth.cloudPreset') || preset;
    } catch {}
    return name && preset ? { name: name.trim(), preset: preset.trim() } : null;
  }
  function shareRoute() {
    const mode = state.cfg.share?.mode || 'auto';
    if (mode === 'off') return null;
    if (mode !== 'lan' && cloudCfg()) return 'cloud';
    if (mode !== 'cloud' && state.server && state.cfg.share?.lanBase) return 'lan';
    return null;
  }
  function describeShare() {
    const r = shareRoute();
    $('shareStatus').textContent = r === 'cloud' ? `On · uploads to Cloudinary (${cloudCfg().name})`
      : r === 'lan' ? `On · store Wi-Fi via ${state.cfg.share.lanBase}`
      : state.server ? 'Off · this PC is not on a network' : 'Off · add a Cloudinary account below, or run the full version';
  }
  const toBlob = (c, q) => new Promise((res) => c.toBlob(res, 'image/jpeg', q));
  async function makeShareLink(no) {
    const route = shareRoute();
    if (!route) return null;
    const gif = state.mode === 'boomerang' && state.rendered.length ? await buildGif() : null;
    if (route === 'cloud') {
      const { name, preset } = cloudCfg();
      const fd = new FormData();
      if (gif) fd.append('file', gif, 'boomerang.gif');
      else fd.append('file', await toBlob(printCanvas, 0.9), 'portrait.jpg');
      fd.append('upload_preset', preset);
      const r = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(name)}/image/upload`, { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.secure_url) throw new Error(j.error?.message || `upload failed (${r.status})`);
      return { url: j.secure_url, note: `Opens your ${gif ? 'boomerang' : 'portrait'} on your phone. Press and hold it to save.` };
    }
    let photo = null;
    if (state.shots.length === 1) {
      const src = state.shots[0], iw = src.videoWidth || src.width, ih = src.videoHeight || src.height;
      const k = Math.min(1, 1600 / Math.max(iw, ih));
      photo = finished(src, iw * k, ih * k, state.filter).toDataURL('image/jpeg', 0.9);
    }
    const r = await fetch('/api/share', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheet: printCanvas.toDataURL('image/jpeg', 0.9), photo, no,
        gif: gif ? await blobToDataUrl(gif) : null,
        place: state.cfg.eventName || state.cfg.storeName
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) throw new Error(j.error || `share failed (${r.status})`);
    const wifi = state.cfg.share?.wifiName;
    return {
      url: j.url,
      note: `${wifi ? `Join the Wi-Fi \u201c${wifi}\u201d first. ` : 'Your phone must be on the store Wi-Fi. '}The link works for ${j.keepDays} days.`
    };
  }
  function drawQR(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text); qr.make();
    const n = qr.getModuleCount(), quiet = 3, cv = $('qrCanvas');
    const cell = Math.floor(cv.width / (n + quiet * 2)), size = cell * (n + quiet * 2);
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size);
    g.fillStyle = '#000000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) g.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
    cv.dataset.url = text;
  }

  // ---------- boomerang ----------
  // A short burst plays forward then backward. The GIF reaches the guest through the
  // QR code, so the option only shows when photo downloads are set up.
  const BURST = 16, BURST_GAP = 90, LOOP_DELAY = 70;
  const GIF_W = 540, GIF_H = 675, GIF_PHOTO = 492, GIF_PAD = 24;
  const loopOrder = (n) => [...Array(n).keys(), ...[...Array(Math.max(0, n - 2)).keys()].map((i) => n - 2 - i)];
  function boomerangOn() {
    return state.cfg.boomerang !== false && !!shareRoute() && !!window.gifenc;
  }
  function renderMode() {
    if (!boomerangOn() && state.mode === 'boomerang') state.mode = 'photo';
    $('modeBox').hidden = !boomerangOn();
    document.querySelectorAll('.mode-opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === state.mode)));
    booth.classList.toggle('is-boomerang', state.mode === 'boomerang');
    const boom = state.mode === 'boomerang';
    $('step2').textContent = boom ? 'Move when it says Go' : 'Hold your pose';
    if (boom) $('attractLede').textContent = 'Choose a timer, then touch anywhere on the screen. Move when it says Go: your boomerang goes to your phone and an A5 portrait prints.';
    else if (state.lede) $('attractLede').textContent = state.lede;
  }
  function grabSquare(size) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    if (state.cfg.mirrorPrint) { g.translate(size, 0); g.scale(-1, 1); }
    drawCover(g, state.stream && video.videoWidth ? video : (state.uploaded || standIn()), 0, 0, size, size);
    return c;
  }
  // Static part of every GIF frame: white card, wordmark, place and portrait number.
  function makeGifBase(no) {
    const c = document.createElement('canvas'); c.width = GIF_W; c.height = GIF_H;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, GIF_W, GIF_H);
    g.strokeStyle = '#000000'; g.lineWidth = 1; g.strokeRect(6.5, 6.5, GIF_W - 13, GIF_H - 13);
    g.textAlign = 'center';
    g.fillStyle = '#6e522b'; g.font = 'italic 600 17px "Bodoni Moda", Georgia, serif';
    g.fillText('The', GIF_W / 2, GIF_PAD + GIF_PHOTO + 40);
    g.fillStyle = '#000000'; g.font = '600 32px "Bodoni Moda", Georgia, serif'; g.letterSpacing = '12px';
    g.fillText('COLLECTIVE', GIF_W / 2 + 6, GIF_PAD + GIF_PHOTO + 76);
    g.fillStyle = '#3a3a3a'; g.font = '700 11px Manrope, "Segoe UI", Arial, sans-serif'; g.letterSpacing = '2px';
    const place = (state.cfg.eventName || state.cfg.storeName || '').toUpperCase();
    g.fillText(`${place}  \u00b7  ${fmtNo(no).toUpperCase()}`, GIF_W / 2 + 1, GIF_PAD + GIF_PHOTO + 108);
    g.letterSpacing = '0px';
    return c;
  }
  function drawGifFrame(g, i) {
    g.drawImage(state.gifBase, 0, 0);
    g.drawImage(state.rendered[i], GIF_PAD, GIF_PAD, GIF_PHOTO, GIF_PHOTO);
    g.strokeStyle = '#000000'; g.lineWidth = 1; g.strokeRect(GIF_PAD + 0.5, GIF_PAD + 0.5, GIF_PHOTO - 1, GIF_PHOTO - 1);
  }
  function stopLoop() { clearInterval(state.loopTimer); state.loopTimer = null; }
  function playLoop() {
    stopLoop();
    if (!state.frames.length) return;
    state.gifBase = makeGifBase(lastNo() + 1);
    state.rendered = state.frames.map((f) => finished(f, GIF_PHOTO, GIF_PHOTO, state.filter));
    const order = loopOrder(state.rendered.length), g = $('loopCanvas').getContext('2d');
    let k = 0;
    drawGifFrame(g, order[0]);
    state.loopTimer = setInterval(() => { k = (k + 1) % order.length; drawGifFrame(g, order[k]); }, LOOP_DELAY);
  }
  async function buildGif() {
    const { GIFEncoder, quantize, applyPalette } = window.gifenc;
    const c = document.createElement('canvas'); c.width = GIF_W; c.height = GIF_H;
    const g = c.getContext('2d', { willReadFrequently: true });
    const enc = GIFEncoder();
    for (const i of loopOrder(state.rendered.length)) {
      drawGifFrame(g, i);
      const { data } = g.getImageData(0, 0, GIF_W, GIF_H);
      const palette = quantize(data, 256);
      enc.writeFrame(applyPalette(data, palette), GIF_W, GIF_H, { palette, delay: LOOP_DELAY });
      await sleep(0); // keep the screen responsive while encoding
    }
    enc.finish();
    return new Blob([enc.bytes()], { type: 'image/gif' });
  }
  const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

  // ---------- stages ----------
  function setStage(name) {
    booth.dataset.stage = name;
    armIdle(name);
  }
  function armIdle(stage) {
    clearTimeout(state.idleTimer);
    if (stage === 'attract' || stage === 'countdown' || stage === 'printing') return;
    state.idleTimer = setTimeout(goHome, state.cfg.idleResetSeconds * 1000);
  }
  function goHome() {
    clearTimeout(state.doneTimer);
    state.run++;               // cancels a countdown in progress
    state.busy = false;
    state.shots = [];
    state.filter = state.cfg.defaultFilter || 'original';
    state.copies = state.cfg.copies || 1;
    state.timer = defaultTimer();
    renderTimer();
    stopLoop();
    state.mode = 'photo'; state.frames = []; state.rendered = [];
    renderMode();
    $('qrBlock').hidden = true;
    updateCopies();
    renderFinishPickers();
    still.hidden = true;
    setStage('attract');
  }
  function updateCopies() {
    $('copiesN').textContent = state.copies;
    $('copiesWord').textContent = state.copies === 1 ? 'copy' : 'copies';
  }

  // ---------- server ----------
  async function loadStatus() {
    try {
      if (location.protocol === 'file:') throw new Error('opened as a file');
      const r = await fetch('/api/status', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.statusText);
      const s = await r.json();
      state.server = s;
      Object.assign(state.cfg, s.config || {});
      $('adminServer').textContent = s.mode === 'dry-run' ? 'Dry run, files only' : `Printing · ${s.platform}`;
      $('adminPrinter').textContent = s.printer || s.printerError || 'none found';
    } catch {
      state.server = null;
      $('adminServer').textContent = 'Browser printing (no print server)';
      $('adminPrinter').textContent = '—';
    }
    applyConfig();
  }
  function applyConfig() {
    const c = state.cfg;
    const place = c.eventName || c.storeName;
    $('storeLabel').textContent = place;
    const city = (c.storeName || '').split(',')[0].trim();
    $('thanks').textContent = city ? `Thank you for visiting The Collective, ${city}.` : 'Thank you for visiting The Collective.';
    const paper = c.paper.name || `${c.paper.widthIn} × ${c.paper.heightIn} in`;
    state.lede = $('attractLede').textContent = c.shots > 1
      ? `Choose a timer, then touch anywhere on the screen. Three shots, one ${paper} print, framed by The Collective.`
      : `Choose a timer, then touch anywhere on the screen. When the count ends, your portrait prints on ${paper}, framed by The Collective.`;
    $('previewCaption').textContent = c.paper.name === 'A5' ? 'Your print · A5 · 148 × 210 mm' : `Your print · ${paper}`;
    $('shotsSelect').value = String(c.shots);
    $('timerSelect').value = String(defaultTimer());
    const cc = cloudCfg();
    $('cloudName').value = cc?.name || ''; $('cloudPreset').value = cc?.preset || '';
    describeShare();
    renderMode();
    $('mirrorChk').checked = !!c.mirrorPreview;
    booth.classList.toggle('mirror', !!c.mirrorPreview);
    const W = Math.round(c.paper.widthIn * c.paper.dpi), H = Math.round(c.paper.heightIn * c.paper.dpi);
    printCanvas.width = W; printCanvas.height = H;
  }

  // ---------- camera ----------
  async function startCamera(deviceId) {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) return cameraUnavailable('not supported in this browser');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      state.stream = stream;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const track = stream.getVideoTracks()[0];
      const st = track?.getSettings?.() || {};
      $('adminCamera').textContent = `${track?.label || 'camera'}${st.width ? ` · ${st.width}×${st.height}` : ''}`;
      video.hidden = false;
      try { if (st.deviceId) localStorage.setItem('booth.camera', st.deviceId); } catch {}
      await listCameras(st.deviceId);
    } catch (err) {
      cameraUnavailable(err.message || String(err));
    }
  }
  function stopCamera() {
    if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
  }
  function cameraUnavailable(reason) {
    $('adminCamera').textContent = `unavailable · ${reason}`;
    video.hidden = true;
    showStill(state.uploaded || standIn());
  }
  function showStill(src) {
    still.width = 1200; still.height = 1200;
    drawCover(still.getContext('2d'), src, 0, 0, 1200, 1200);
    still.hidden = false;
  }
  async function listCameras(currentId) {
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      const sel = $('cameraSelect'); sel.innerHTML = '';
      devs.forEach((d, i) => {
        const o = document.createElement('option');
        o.value = d.deviceId; o.textContent = d.label || `Camera ${i + 1}`;
        if (d.deviceId === currentId) o.selected = true;
        sel.appendChild(o);
      });
    } catch {}
  }

  function grabFrame() {
    if (state.stream && video.videoWidth) {
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      const g = c.getContext('2d');
      if (state.cfg.mirrorPrint) { g.translate(c.width, 0); g.scale(-1, 1); }
      g.drawImage(video, 0, 0);
      return c;
    }
    return state.uploaded || standIn();
  }
  // Studio backdrop with a silhouette, used only when there is no camera and no chosen photo.
  function standIn() {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 1200;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 500, 1200);
    bg.addColorStop(0, '#d8c4a6'); bg.addColorStop(0.55, '#a28c72'); bg.addColorStop(1, '#6b5a4a');
    g.fillStyle = bg; g.fillRect(0, 0, 1200, 1200);
    const key = g.createRadialGradient(840, 290, 20, 840, 290, 640);
    key.addColorStop(0, 'rgba(255,238,210,.95)'); key.addColorStop(1, 'rgba(255,238,210,0)');
    g.fillStyle = key; g.fillRect(0, 0, 1200, 1200);
    g.fillStyle = '#4a2a3c'; g.beginPath(); g.ellipse(600, 1200, 480, 400, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1f6f78'; g.beginPath(); g.ellipse(600, 804, 204, 72, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a1f18';
    g.beginPath(); g.ellipse(600, 696, 84, 120, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(600, 468, 180, 228, 0, 0, Math.PI * 2); g.fill();
    return c;
  }

  // ---------- capture ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function captureSequence() {
    if (state.busy) return;
    state.busy = true;
    const run = ++state.run;
    const live = () => run === state.run;
    state.shots = [];
    const boom = state.mode === 'boomerang';
    const total = boom ? 1 : (state.cfg.shots || 1);
    state.frames = [];
    stopLoop();
    setStage('countdown');
    for (let i = 0; i < total; i++) {
      $('shotLabel').textContent = total > 1 ? `Shot ${i + 1} of ${total} · Eyes to the lens` : 'Eyes to the lens';
      for (let n = state.timer; n >= 1; n--) {
        const el = $('countNum');
        el.textContent = n; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
        await sleep(1000);
        if (!live()) return;
      }
      if (boom) {
        $('shotLabel').textContent = 'Move now';
        const el = $('countNum'); el.textContent = 'Go'; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
        const bar = $('recBar');
        bar.style.setProperty('--rec', `${BURST * BURST_GAP}ms`);
        bar.classList.remove('on'); void bar.offsetWidth; bar.classList.add('on');
        for (let f = 0; f < BURST; f++) {
          state.frames.push(grabSquare(1080));
          await sleep(BURST_GAP);
          if (!live()) { bar.classList.remove('on'); return; }
        }
        bar.classList.remove('on');
        state.shots.push(state.frames[Math.floor(BURST / 2)]);
        continue;
      }
      flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
      state.shots.push(grabFrame());
      await sleep(total > 1 ? 1000 : 450);
      if (!live()) return;
    }
    await compose(printCanvas, state.shots);
    paintThumbs();
    if (!live()) return;
    if (boom) playLoop();
    $('previewCaption').textContent = boom ? 'Your boomerang · prints as an A5 portrait'
      : (state.cfg.paper.name === 'A5' ? 'Your print · A5 · 148 × 210 mm' : 'Your print');
    state.busy = false;
    setStage('review');
    if (state.cfg.autoPrint) { await sleep(1800); doPrint(); }
  }

  // ---------- the print ----------
  // Laid out on a 559 x 794 grid (A5 at 96 px/in), scaled to the paper at its dpi.
  async function compose(canvas, frames) {
    const { widthIn, heightIn, dpi } = state.cfg.paper;
    const W = Math.round(widthIn * dpi), H = Math.round(heightIn * dpi);
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const u = W / 559, Hu = H / u;
    const SERIF = '"Bodoni Moda", Didot, "Playfair Display", Georgia, serif';
    const SANS = 'Manrope, "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
    const INK = '#000000', PAPER = '#ffffff', BRONZE = '#6e522b', LINE = '#b39669', GREY = '#3a3a3a';
    try {
      await Promise.all([
        document.fonts.load(`600 ${40 * u}px "Bodoni Moda"`),
        document.fonts.load(`italic 600 ${17 * u}px "Bodoni Moda"`),
        document.fonts.load(`700 ${9 * u}px Manrope`)
      ]);
    } catch {}

    g.save();
    g.scale(u, u);
    const w = 559, h = Hu;
    g.fillStyle = PAPER; g.fillRect(0, 0, w, h);

    // outer black hairline
    g.strokeStyle = INK; g.lineWidth = 0.75;
    g.strokeRect(7, 7, w - 14, h - 14);

    // running wordmark on all four sides
    g.fillStyle = INK; g.font = `600 7.2px ${SERIF}`; g.letterSpacing = '1.9px';
    g.textBaseline = 'middle'; g.textAlign = 'left';
    const word = 'THE COLLECTIVE · ';
    const ww = g.measureText(word).width;
    const band = (len) => {
      const n = Math.ceil(len / ww) + 1, total = n * ww, x0 = (len - total) / 2;
      g.save(); g.beginPath(); g.rect(0, -8, len, 16); g.clip();
      for (let k = 0; k < n; k++) g.fillText(word, x0 + k * ww, 0);
      g.restore();
    };
    g.save(); g.translate(26, 18); band(w - 52); g.restore();
    g.save(); g.translate(w - 26, h - 18); g.rotate(Math.PI); band(w - 52); g.restore();
    g.save(); g.translate(18, h - 26); g.rotate(-Math.PI / 2); band(h - 52); g.restore();
    g.save(); g.translate(w - 18, 26); g.rotate(Math.PI / 2); band(h - 52); g.restore();

    // corner monograms
    g.fillStyle = BRONZE; g.font = `italic 600 10px ${SERIF}`; g.letterSpacing = '0px'; g.textAlign = 'center';
    [[18, 18], [w - 18, 18], [18, h - 18], [w - 18, h - 18]].forEach(([x, y]) => g.fillText('C', x, y + 0.5));

    // inner bronze hairline
    g.strokeStyle = LINE; g.lineWidth = 0.75;
    g.strokeRect(32, 32, w - 64, h - 64);

    // header
    g.textBaseline = 'alphabetic'; g.textAlign = 'center';
    g.fillStyle = BRONZE; g.font = `italic 600 17px ${SERIF}`;
    g.fillText('The', w / 2, 76);
    g.fillStyle = INK; g.font = `600 40px ${SERIF}`; g.letterSpacing = '15.2px';
    g.fillText('COLLECTIVE', w / 2 + 7.6, 114);
    g.letterSpacing = '0px';
    g.fillStyle = LINE; g.fillRect(w / 2 - 18, 127, 36, 0.75);

    // footer
    const fy = h - 144;
    g.fillStyle = LINE; g.fillRect(w / 2 - 18, fy, 36, 0.75);
    g.fillStyle = INK; g.font = `600 18px ${SERIF}`; g.letterSpacing = '0.6px';
    g.fillText(state.cfg.eventName || state.cfg.storeName, w / 2 + 0.3, fy + 28);
    const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
    const meta = `${date}  \u00b7  ${fmtNo(lastNo() + 1).toUpperCase()}`;
    g.fillStyle = GREY; g.font = `700 8.5px ${SANS}`; g.letterSpacing = '1.8px';
    g.fillText(meta, w / 2 + 0.9, fy + 48);
    if (state.cfg.hashtag) {
      g.fillStyle = BRONZE; g.font = `700 9px ${SANS}`; g.letterSpacing = '0.9px';
      g.fillText(state.cfg.hashtag, w / 2 + 0.6, fy + 66);
    }
    g.letterSpacing = '0px';

    // photos, between header (y 140) and footer rule
    const top = 140, bottom = fy - 12, avail = bottom - top, n = frames.length;
    let boxes = [];
    if (n === 1) {
      const S = Math.min(420, avail - 12);
      boxes.push({ x: (w - S) / 2, y: top + (avail - S) / 2, w: S, h: S });
    } else {
      const gap = 12, rh = Math.min((avail - 12 - gap * (n - 1)) / n, 420 * 9 / 16), rw = rh * 16 / 9;
      const y0 = top + (avail - (rh * n + gap * (n - 1))) / 2;
      for (let i = 0; i < n; i++) boxes.push({ x: (w - rw) / 2, y: y0 + i * (rh + gap), w: rw, h: rh });
    }
    g.restore();

    // draw photos at full print resolution
    boxes.forEach((b, i) => {
      const px = b.x * u, py = b.y * u, pw = b.w * u, ph = b.h * u;
      g.drawImage(finished(frames[i], pw, ph, state.filter), px, py, pw, ph);
      g.strokeStyle = INK; g.lineWidth = 1 * u; g.strokeRect(px, py, pw, ph);
      g.strokeStyle = LINE; g.lineWidth = 0.75 * u; g.strokeRect(px - 5.5 * u, py - 5.5 * u, pw + 11 * u, ph + 11 * u);
    });
  }

  // ---------- print ----------
  // Print from the browser itself: an A5 page holding only the composed sheet.
  async function printViaBrowser(dataUrl, copies) {
    const { widthIn, heightIn } = state.cfg.paper;
    let page = document.getElementById('pageSize');
    if (!page) { page = document.createElement('style'); page.id = 'pageSize'; document.head.appendChild(page); }
    page.textContent = `@page { size: ${widthIn}in ${heightIn}in; margin: 0; }
      @media print { .print-sheet { width: ${widthIn}in; height: ${heightIn}in; } }`;
    const img = $('printImg');
    await new Promise((res) => { img.onload = res; img.onerror = res; img.src = dataUrl; });
    for (let i = 0; i < copies; i++) { window.print(); await sleep(300); }
  }

  async function doPrint() {
    if (state.busy) return;
    state.busy = true;
    setStage('printing');
    const started = Date.now();
    const no = lastNo() + 1;
    $('qrBlock').hidden = true;
    $('qrTitle').textContent = state.mode === 'boomerang' ? 'Scan to save your boomerang' : 'Scan to save your portrait';
    const sharing = makeShareLink(fmtNo(no)).catch((e) => {
      $('adminError').textContent = `QR code not made: ${e.message || e}`;
      return null;
    });
    try {
      const dataUrl = printCanvas.toDataURL('image/png');
      await sleep(400); // let the printing screen paint first
      if (state.server) {
        const r = await fetch('/api/print', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl, copies: state.copies })
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || r.statusText);
        $('adminLast').textContent = `${fmtNo(no)} · ${j.mode === 'dry-run' ? 'saved' : 'printed'} ${j.file}`;
      } else {
        await printViaBrowser(dataUrl, state.copies);
        $('adminLast').textContent = `${fmtNo(no)} · sent to the browser printer`;
      }
      saveNo(no);
      $('doneImg').src = printCanvas.toDataURL('image/jpeg', 0.85);
      $('doneNo').textContent = `Printed · Portrait ${fmtNo(no)}`;
      const link = await Promise.race([sharing, sleep(state.mode === 'boomerang' ? 20000 : 10000).then(() => null)]);
      stopLoop();
      if (link) {
        drawQR(link.url);
        $('qrNote').textContent = link.note;
        $('qrBlock').hidden = false;
      }
      await sleep(Math.max(0, 1800 - (Date.now() - started)));
      state.busy = false;
      setStage('done');
      state.doneTimer = setTimeout(() => { if (booth.dataset.stage === 'done') goHome(); }, link ? 45000 : 9000);
    } catch (err) {
      state.busy = false;
      $('adminError').textContent = `Last print failed: ${err.message || err}`;
      setStage('error');
    }
  }

  // ---------- touch anywhere ----------
  booth.addEventListener('click', (e) => {
    if (booth.dataset.stage !== 'attract') return;
    if (e.target.closest('#admin, #adminBtn, #homeBtn, .timer, .mode')) return;
    captureSequence();
  });

  // ---------- staff settings ----------
  let taps = 0, tapTimer;
  $('adminBtn').addEventListener('click', () => {
    taps++; clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { taps = 0; }, 1600);
    if (taps >= 5) { taps = 0; $('admin').hidden = false; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('admin').hidden = !$('admin').hidden; return; }
    if (!$('admin').hidden) return;
    if ((e.key === ' ' || e.key === 'Enter') && booth.dataset.stage === 'attract') { e.preventDefault(); captureSequence(); }
    else if (e.key === 'Enter' && booth.dataset.stage === 'review') doPrint();
    else if (e.key === 'Escape') goHome();
  });
  $('adminClose').addEventListener('click', () => { $('admin').hidden = true; });
  $('cameraSelect').addEventListener('change', (e) => startCamera(e.target.value));
  $('shotsSelect').addEventListener('change', (e) => { state.cfg.shots = Number(e.target.value); applyConfig(); });
  $('mirrorChk').addEventListener('change', (e) => { state.cfg.mirrorPreview = e.target.checked; booth.classList.toggle('mirror', e.target.checked); });
  $('timerSelect').addEventListener('change', (e) => {
    try { localStorage.setItem('booth.timer', e.target.value); } catch {}
    state.timer = defaultTimer(); renderTimer();
  });
  const saveCloud = () => {
    try {
      localStorage.setItem('booth.cloudName', $('cloudName').value.trim());
      localStorage.setItem('booth.cloudPreset', $('cloudPreset').value.trim());
    } catch {}
    describeShare();
    renderMode();
  };
  document.querySelectorAll('.mode-opt').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode; renderMode();
  }));
  $('cloudName').addEventListener('change', saveCloud);
  $('cloudPreset').addEventListener('change', saveCloud);
  $('fullscreenBtn').addEventListener('click', () => document.documentElement.requestFullscreen?.().catch(() => {}));
  $('uploadInput').addEventListener('change', (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      state.uploaded = c; URL.revokeObjectURL(img.src);
      if (!state.stream) showStill(c);
    };
    img.src = URL.createObjectURL(file);
  });
  $('testPrintBtn').addEventListener('click', async () => {
    $('admin').hidden = true;
    state.shots = Array.from({ length: state.cfg.shots || 1 }, grabFrame);
    await compose(printCanvas, state.shots);
    paintThumbs();
    doPrint();
  });

  // ---------- review controls ----------
  $('printBtn').addEventListener('click', doPrint);
  $('retakeBtn').addEventListener('click', captureSequence);
  $('againBtn').addEventListener('click', goHome);
  $('homeBtn').addEventListener('click', goHome);
  $('retryBtn').addEventListener('click', doPrint);
  $('errorHomeBtn').addEventListener('click', goHome);
  document.querySelectorAll('.round').forEach((b) => b.addEventListener('click', () => {
    state.copies = Math.min(5, Math.max(1, state.copies + Number(b.dataset.delta)));
    updateCopies();
    armIdle('review');
  }));
  document.addEventListener('pointerdown', () => armIdle(booth.dataset.stage), { passive: true });

  (async () => {
    renderFinishPickers();
    await loadStatus();
    let saved = null;
    try { saved = localStorage.getItem('booth.camera'); } catch {}
    await startCamera(saved || undefined);
    if (!state.stream && saved) await startCamera();
    goHome();
  })();
})();
