THE COLLECTIVE PHOTO BOOTH - QUICK START (no install)

1. Plug in the webcam.
2. Make the photo printer the DEFAULT printer in Windows
   (Settings > Bluetooth & devices > Printers & scanners), and set its
   paper size to A5 in Printing preferences.
3. Double-click "Start Booth.bat".

The booth opens full screen. Guests touch the screen, pick a finish and
the A5 print comes out of the default printer with no dialog.

Guests pick a 3, 5 or 10 second timer, then touch anywhere to start.

Staff settings: tap THE COLLECTIVE wordmark 5 times (or Ctrl + A).
  Choose the camera, the default timer, run a test print, or load a
  photo if no camera.

QR code for guests to download their photo:
  This version needs a free Cloudinary account (cloud name + an
  UNSIGNED upload preset). Enter both in staff settings under
  "Photo download QR". Without it, no QR code is shown.
  The full version (start-kiosk.bat) can also share over the store
  Wi-Fi with no account. See README.md.
Leave the booth: Alt + F4.

If the printer dialog appears instead of printing silently, Chrome was
already running with this profile. Close every Chrome window and start
the booth again.

For printer selection by name, saved copies of every print, and other
options, use the full version: start-kiosk.bat in the folder above
(needs Node.js).
