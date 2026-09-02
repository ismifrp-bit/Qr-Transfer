# QR Transfer

Move text, links, and files between two nearby devices using nothing but QR
codes. No internet connection, no server, no cloud storage, no account.
Everything happens in the browser on both devices.

```
Device A (sender)                     Device B (receiver)
──────────────────                    ────────────────────
Select data
   ↓
Compress (optional)
   ↓
Encrypt (optional, AES-GCM)
   ↓
Split into QR-sized chunks   ───────▶  Camera scans each QR
   ↓                                      ↓
Display QR codes, one                 Validate + store chunk
after another                             ↓
                                       All chunks in? Reassemble
                                          ↓
                                       Decrypt (if needed)
                                          ↓
                                       Decompress (if needed)
                                          ↓
                                       Verify SHA-256
                                          ↓
                                       Ready to open / download
```

## Why this exists

A single QR code can only hold about 2–3 KB even at low error correction.
This app doesn't pretend otherwise — it splits real data into many QR
frames using a small custom protocol (`QRT1`, see below), plays them back
on the sender's screen, and reassembles them as the receiver's camera
scans. Small payloads (a short note, a link, a contact) fit in a single
frame; anything bigger becomes an animated sequence.

## Features

- **Text, links, contacts, and files** (images, PDFs, text, JSON, small
  documents).
- **Automatic chunking** with a compact wire format, not verbose JSON per
  packet.
- **Missing-chunk recovery** — the receiver shows exactly which chunk
  numbers didn't arrive; the sender can replay just those.
- **Optional password protection** — AES-256-GCM, key derived with
  PBKDF2 (250,000 iterations), all via the browser's native Web Crypto
  API. The password is never included in the QR data and never stored.
- **SHA-256 integrity check** on every completed transfer.
- **Optional gzip compression** before sending (via `CompressionStream`).
- **Installable PWA** — after the first visit, the app shell is cached
  and keeps working with no network.
- **Runs entirely client-side.** Nothing is uploaded anywhere.

## Project structure

```
qr-transfer/
├── index.html            single-page app: home, send, QR display, receive, result
├── css/
│   ├── style.css
│   └── responsive.css
├── js/
│   ├── app.js             navigation, theme, service-worker bootstrap
│   ├── sender.js           compose data, drive the transfer worker, QR playback
│   ├── receiver.js         camera loop, chunk tracking, decrypt/verify/result
│   ├── qr-generator.js     wraps the QR-drawing library
│   ├── qr-scanner.js       wraps camera + QR-decoding library
│   ├── chunk-manager.js    the QRT1 packet protocol (build/parse/reassemble)
│   ├── crypto.js           PBKDF2 + AES-GCM helpers
│   ├── compression.js      gzip helpers (CompressionStream)
│   ├── file-handler.js     File/Blob/download helpers
│   └── utils.js            base64, CRC32, SHA-256, formatting
├── workers/
│   └── transfer-worker.js  off-main-thread hash/compress/encrypt/chunk
├── icons/                  PWA icons
├── manifest.json
├── service-worker.js       offline app-shell cache
└── README.md
```

Note on structure vs. the original spec: this build uses **one HTML page**
(`index.html`) with client-side view switching instead of separate
`send.html`/`receive.html` pages. That keeps the camera stream and any
in-progress transfer alive while navigating, which matters a lot on
mobile — a full page reload would drop the camera and any partial scan
progress.

## The QRT1 packet format

Each QR code encodes one pipe-delimited packet:

```
Header:  QRT1|H|<transferId>|<totalChunks>|<crc32>|<base64(json metadata)>
Data:    QRT1|D|<transferId>|<index>|<totalChunks>|<crc32>|<base64 payload>
```

The header packet's JSON carries filename, MIME type, original/payload
size, SHA-256 of the (possibly compressed/encrypted) payload, and — if
password protection was used — the encryption salt and IV. Every packet
carries its own CRC32 so a single damaged frame is detected and skipped
without corrupting the rest of the transfer. The receiver tracks which
chunk indices have arrived, can tell you exactly which are missing, and
reassembles them in order once complete — duplicates and out-of-order
scans are handled automatically.

## Vendoring the QR libraries (recommended for strict offline/no-CDN use)

This build uses two small, well-known open-source libraries, loaded via
`<script>` tags in `index.html`:

- QR **generation**: `qrcode.min.js` (davidshimjs/qrcodejs, MIT)
- QR **scanning**: `jsQR.js` (cozmo/jsQR, MIT)

By default they're loaded from cdnjs and then cached by the service
worker, so the app works offline after the first successful visit. If
your deployment can't depend on a CDN at all (e.g. an air-gapped
environment), download both files once and vendor them locally:

1. Download `qrcode.min.js` and `jsQR.js` from their respective GitHub
   releases or from cdnjs.
2. Place them at `js/vendor/qrcode.min.js` and `js/vendor/jsqr.min.js`.
3. In `index.html`, replace the two CDN `<script src="https://cdnjs...">`
   tags with `<script src="js/vendor/qrcode.min.js" defer></script>` and
   `<script src="js/vendor/jsqr.min.js" defer></script>`.
4. In `service-worker.js`, remove the `THIRD_PARTY` array (or point it at
   the new local paths — same-origin files are already precached via
   `APP_SHELL`).

The Google Fonts link tags in `<head>` are optional polish; delete them
and the app falls back to system fonts with no loss of function.

## Practical size limits

QR transfer is not fast — treat it like a slow serial link, not Wi-Fi:

| File size | Rough frame count* | Rough time* |
|---|---|---|
| 2 KB (a note)   | 1 frame   | instant |
| 100 KB          | ~150      | ~1 minute |
| 1 MB            | ~1,500    | ~10 minutes |
| 5 MB            | ~7,500    | ~1 hour |

*At "medium" density and default 450 ms/frame. Use "low" density for
more reliable scanning in poor lighting, "high" for fewer frames on a
good camera. The app shows a live estimate before you generate codes.
**We recommend staying under a few megabytes** — past that, a direct
file transfer method will be far more practical.

## Deployment (static hosting, no backend required)

Works as-is on any static host:

```
1. Create a GitHub repository
2. Upload this project's files (keep the folder structure)
3. Repo Settings → Pages → deploy from the main branch
4. Open the published URL
5. Add to home screen / Install (this triggers the PWA install)
6. Turn on airplane mode — it still works
```

The same files work unmodified on Cloudflare Pages, Netlify, or Vercel —
just point the static-site build at the repository root with no build
command.

**HTTPS is required** for camera access (`getUserMedia`) and service
workers to work, except on `localhost`. GitHub Pages, Netlify, Vercel,
and Cloudflare Pages all serve HTTPS by default.

## Local development

No build step. Serve the folder over HTTP (camera access needs a proper
origin, not `file://`):

```bash
cd qr-transfer
python3 -m http.server 8080
# open http://localhost:8080
```

To test device-to-device, open the local server's LAN address
(e.g. `http://192.168.1.23:8080`) on a second device on the same
Wi-Fi — or just use two browser tabs/windows for a quick check, since
nothing here actually depends on the network being present.

## Testing checklist

- [ ] Send a short text note, phone → phone
- [ ] Send a link
- [ ] Send a contact card and confirm the receiving phone offers to save it
- [ ] Send an image, phone → phone
- [ ] Send a PDF or small document
- [ ] Send a password-protected file; confirm a wrong password is rejected
      and the correct one decrypts it
- [ ] Pause playback mid-transfer, resume, confirm no duplicate frames
      break reassembly
- [ ] Cover the sender's screen for a few frames, confirm the receiver
      reports the missing chunk numbers, then use "Replay listed chunks"
      on the sender and confirm recovery
- [ ] Point the camera at an unrelated QR code and confirm it's ignored
      instead of breaking the in-progress session
- [ ] Turn off Wi-Fi and mobile data on both devices after the first load
      and confirm the app still opens and works fully

## Privacy & security notes

- No network requests are made with your data, ever — everything is
  local to the two devices' browsers.
- Passwords are used only in memory to derive an AES key via PBKDF2 and
  are never written to storage or included in any packet.
- SHA-256 verification means a modified or truncated transfer is
  detected rather than silently accepted.
- Nothing is written to IndexedDB or localStorage; each transfer session
  lives in page memory and is discarded on cancel, completion, or reload.

This is a browser app; double-check its behavior in your target browsers
before relying on it for anything sensitive, and treat "password
protected" as protection against casual interception on-screen, not as
a substitute for a properly audited security tool.
