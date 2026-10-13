# The Collective · Photo Booth

A self-contained photo booth for an in-store PC with a webcam and a photo printer.
Guests tap one button, the camera takes the shot, and a **4 × 6 inch (10 × 15 cm) print**
framed with The Collective branding is sent straight to the printer. No dialogs, no files to click.

```
webcam ──▶ browser kiosk UI (public/) ──▶ POST /api/print ──▶ server.js ──▶ printer
                      │                                          │
                      └─ composes the branded 1200×1800 px print  └─ PNG → 4×6 PDF → OS print queue
```

## About the brand

The Collective is Aditya Birla Fashion & Retail's luxury multi-brand chain (first store Mumbai, 2009;
85+ international labels across 17+ cities; recent stores use bronze metalwork, glass and a backlit
prismatic wordmark). The booth borrows that language: black and ivory, a bronze accent, a serif
wordmark, and the brand name running around every edge of the screen and the print.

Brand copy used on the print ("India's largest luxury multi-brand retailer", `#TheCollectiveIndia`)
can be changed in `config.json`.

## Quick start

Requirements: Node.js 18+, Google Chrome (or Edge), a webcam, a printer installed in the OS.

```bash
npm install
npm run printers      # lists printers the OS can see; copy the exact name into config.json
npm start             # http://localhost:3000
```

On the booth PC just double-click **`start-kiosk.bat`** (Windows) or run `./start-kiosk.sh` (macOS/Linux).
It starts the server and opens Chrome full-screen in kiosk mode with the camera pre-approved.

To try it without a printer:

```bash
npm run dev           # DRY_RUN=1: prints are saved to ./prints/ as PNG + PDF, nothing is sent
```

## Configuration (`config.json`)

| Key | What it does |
| --- | --- |
| `storeName`, `eventName` | Shown on screen and printed in the footer (`eventName` wins when set). |
| `hashtag` | Printed in bronze under the date. |
| `shots` | `1` = single portrait, `3` = three-shot strip on one sheet. |
| `countdownSeconds` | Countdown before each shot. |
| `autoPrint` | `true` skips the review screen and prints immediately. |
| `copies` | Default copies per print (guest can adjust 1–5 on the review screen). |
| `mirrorPreview` / `mirrorPrint` | Mirror the live view (selfie feel) and/or the printed photo. |
| `idleResetSeconds` | Return to the start screen after inactivity. |
| `paper` | Print size and resolution. Default 4 × 6 in at 300 dpi → 1200 × 1800 px. |
| `printer.name` | Exact printer name from `npm run printers`. Empty = system default. |
| `printer.windowsPaperSize` | Windows only: a paper size name the driver lists (e.g. `4x6`, `Postcard`). |
| `printer.dryRun` | Save files, don't print. |

Environment overrides: `PORT`, `PRINTER`, `DRY_RUN=1`.

## Printer notes

* **Windows**: printing goes through `pdf-to-printer` (bundled SumatraPDF), silent, scale-to-fit.
  Set the printer's default paper to 4×6 / Postcard in *Printing Preferences* once so the driver
  doesn't letterbox. Dye-sub printers (DNP, Canon SELPHY, HiTi) and inkjets with a 4×6 tray all work.
* **macOS / Linux**: printing goes through CUPS `lp` with `media=Custom.4x6in` and `fit-to-page`.
* Every print is also saved to `prints/` (PNG + PDF) for reprints.
* Different paper (e.g. 5 × 7 in): change `paper.widthIn`/`heightIn`; the layout scales.

## In the booth

* Tap **Tap to begin** (or press Space). Countdown → flash → review.
* **Print** (Enter) sends it; **Retake** goes again; the screen resets itself after the print.
* Settings drawer: tap the wordmark 5 times or press **Ctrl + A**: choose camera, shots, mirror,
  run a test print, enter fullscreen.

## Files

```
server.js             Express print server (status, printers, print)
config.json           booth + printer settings
public/index.html     kiosk markup
public/styles.css     design tokens and layout
public/app.js         camera, countdown, print composition, printing
scripts/build-single-file.mjs   bundles public/ into dist/booth.html for previews
start-kiosk.bat / .sh launchers
prints/               saved prints
```
