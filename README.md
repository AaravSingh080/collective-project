# The Collective · Photo Booth

A self-contained photo booth for an in-store PC with a webcam and a photo printer.
Guests touch anywhere on the screen, the camera takes the shot, they pick a finish, and an
**A5 print (half an A4 sheet, 148 × 210 mm)** framed with The Collective branding is sent straight
to the printer. Screen and print are pure white with the black Didone wordmark.

Finishes: three signature ones made for the brand, plus six classics including Vintage.

| Finish | What it does |
| --- | --- |
| **Gelatin** | Darkroom black and white: deep blacks, cool silver tone, fine grain, soft vignette. |
| **Façade** | Bronze duotone from the store façades: espresso shadows, champagne highlights. |
| **Prism** | Colour with a fine red/blue light split at the edges and a faint spectral leak, after the backlit prismatic sign. |
| **Vintage** | Black and white on faded old paper: lifted blacks, heavy clumpy grain, dust, hairline scratches, deep vignette. |
| Colour, Mono, Noir, Warm, Vivid | Classic adjustments. | No dialogs, no files to click.

```
webcam ──▶ browser kiosk UI (public/) ──▶ POST /api/print ──▶ server.js ──▶ printer
                      │                                          │
                      └─ composes the branded 1748×2480 px print  └─ PNG → A5 PDF → OS print queue
```

## About the brand

The Collective is Aditya Birla Fashion & Retail's luxury multi-brand chain (first store Mumbai, 2009;
85+ international labels across 17+ cities; recent stores use bronze metalwork, glass and a backlit
prismatic wordmark). The booth borrows that language: black and ivory, a bronze accent, a serif
wordmark, and the brand name running around every edge of the screen and the print.

Brand copy used on the print ("India's largest luxury multi-brand retailer", `#TheCollectiveIndia`)
can be changed in `config.json`.

## Go live in 3 minutes (no install)

Only Google Chrome is needed. No Node.js, no internet once it is running.

1. Download the booth:
   https://github.com/AaravSingh080/collective-project/archive/refs/heads/claude/cool-fermat-h8qdyv.zip
   and unzip it on the booth PC.
2. Plug in the webcam. Make the photo printer the **default printer** and set its paper to **A5**.
3. Open the `kiosk` folder and double-click **`Start Booth.bat`**.

Chrome opens the booth full screen with the camera allowed, and Chrome's kiosk printing sends each
A5 sheet straight to the default printer with no dialog. Fonts are built into `kiosk/booth.html`,
so it looks right offline. Every print is numbered (Portrait No. 0001, 0002, ...) on that PC.

## Full version (Windows, needs Node.js)

Use this when you want to pick the printer by name, keep a PNG and PDF of every print, or use
dry-run testing. Everything else is the same as the no-install version.

1. Install **Node.js LTS** from nodejs.org and **Google Chrome**, if they are not there already.
2. Plug in the webcam. Set the photo printer as the **default printer** and set its paper to **A5**
   in *Printing Preferences*.
3. Download this repository (GitHub › Code › Download ZIP, on branch `claude/cool-fermat-h8qdyv`)
   and unzip it anywhere, for example the Desktop.
4. Double-click **`start-kiosk.bat`**. The first run installs the booth, lists the printers it can see,
   and opens the booth full-screen with the camera already allowed.

To leave the kiosk press **Alt + F4**, then close the minimised "Collective Booth Server" window.
If Chrome picks the wrong camera, open staff settings (tap the wordmark 5 times) and choose it; the
booth remembers it next time. Use **Test print** there to check the printer.

## Quick start (developers)

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
| `paper` | Print size: `name` (OS media name, e.g. `A5`, `A4`, `4x6`), `widthIn`, `heightIn`, `dpi`. Default A5 at 300 dpi → 1748 × 2480 px. |
| `defaultFilter` | Finish pre-selected on the review screen: `gelatin`, `facade`, `prism`, `original`, `mono`, `noir`, `warm`, `vintage`, `vivid`. |
| `printer.name` | Exact printer name from `npm run printers`. Empty = system default. |
| `printer.windowsPaperSize` | Windows only: override the paper-size name sent to the driver (defaults to `paper.name`). |
| `printer.dryRun` | Save files, don't print. |

Environment overrides: `PORT`, `PRINTER`, `DRY_RUN=1`.

## Printer notes

* **Windows**: printing goes through `pdf-to-printer` (bundled SumatraPDF), silent, scale-to-fit.
  Set the printer's default paper to A5 in *Printing Preferences* once so the driver doesn't letterbox.
  Any A4 inkjet/laser can print A5 from its tray; dye-sub photo printers work with their own sizes.
* **macOS / Linux**: printing goes through CUPS `lp` with `media=A5` and `fit-to-page`.
* Every print is also saved to `prints/` (PNG + PDF) for reprints.
* Different paper (e.g. 4 × 6 in or A4): change `paper.name`, `widthIn` and `heightIn`; the layout scales.

## In the booth

* Touch anywhere on the welcome screen (or press Space). Countdown → flash → review.
* Pick a finish on the review screen; the A5 preview updates instantly.
* **Print** (Enter) sends it; **Retake** goes again; the screen resets itself after the print.
* Staff settings: tap the wordmark 5 times or press **Ctrl + A**. It shows printer and camera status,
  and lets staff choose the camera, shots and mirror, load a photo if no camera is attached, run a
  test print, and go fullscreen. Guests never see status or test text.

## Files

```
server.js             Express print server (status, printers, print)
config.json           booth + printer settings
kiosk/booth.html      the whole booth in one file (no-install version, built from public/)
kiosk/Start Booth.bat no-install launcher: Chrome kiosk + silent printing
public/index.html     kiosk markup
public/fonts/         Bodoni Moda and Manrope (SIL Open Font License)
public/styles.css     design tokens and layout
public/app.js         camera, countdown, print composition, printing
scripts/build-single-file.mjs   rebuilds kiosk/booth.html after any change in public/
start-kiosk.bat / .sh launchers
prints/               saved prints
```
