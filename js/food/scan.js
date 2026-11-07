// Barcode scanning with the phone camera (works offline; decoder is bundled with the app).
// Uses html5-qrcode (ZXing) — Safari has no built-in barcode detector.

let loading = null;
function loadLib() {
  if (window.__Html5QrcodeLibrary__) return Promise.resolve(window.__Html5QrcodeLibrary__);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/html5-qrcode.min.js';
      s.onload = () => (window.__Html5QrcodeLibrary__ ? resolve(window.__Html5QrcodeLibrary__) : reject(new Error('Scanner failed to load.')));
      s.onerror = () => { loading = null; reject(new Error('Scanner failed to load.')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

function formats(lib) {
  const F = lib.Html5QrcodeSupportedFormats;
  return [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.ITF];
}

export class Scanner {
  constructor(elementId) { this.elementId = elementId; this.inst = null; this.running = false; }
  async start(onCode) {
    const lib = await loadLib();
    this.inst = new lib.Html5Qrcode(this.elementId, { formatsToSupport: formats(lib), verbose: false, useBarCodeDetectorIfSupported: true });
    let last = null, hits = 0;
    await this.inst.start(
      { facingMode: 'environment' },
      { fps: 12, qrbox: (w, h) => ({ width: Math.round(Math.min(w * 0.86, 340)), height: Math.round(Math.min(h * 0.5, 150)) }), disableFlip: true },
      (text) => {
        const code = String(text).replace(/\D/g, '');
        if (!code) return;
        // Require two identical reads in a row to avoid mis-reads.
        if (code === last) hits++; else { last = code; hits = 1; }
        if (hits >= 2 && this.running) { this.running = false; onCode(code); }
      },
      () => {},
    );
    this.running = true;
  }
  async stop() {
    this.running = false;
    const inst = this.inst; this.inst = null;
    if (!inst) return;
    try { if (inst.isScanning) await inst.stop(); } catch {}
    try { inst.clear(); } catch {}
  }
  /** Torch on/off where supported (not on iPhone Safari at the moment). */
  async torch(on) {
    try { await this.inst.applyVideoConstraints({ advanced: [{ torch: !!on }] }); return true; } catch { return false; }
  }
}

/** Decode a barcode from a still photo. */
export async function scanImageFile(file, elementId) {
  const lib = await loadLib();
  const inst = new lib.Html5Qrcode(elementId, { formatsToSupport: formats(lib), verbose: false, useBarCodeDetectorIfSupported: true });
  try {
    const text = await inst.scanFile(file, false);
    return String(text).replace(/\D/g, '');
  } catch { return null; }
  finally { try { inst.clear(); } catch {} }
}

export function cameraErrorMessage(e) {
  const name = e && (e.name || '');
  const msg = String((e && e.message) || e || '');
  if (/NotAllowed|Permission/i.test(name + msg)) return 'Camera access was denied. Allow camera access for GymOS in Settings, or take a photo of the barcode instead.';
  if (/NotFound|Overconstrained/i.test(name + msg)) return 'No camera was found. Type the barcode or use a photo.';
  if (/NotReadable|in use/i.test(name + msg)) return 'The camera is busy in another app. Close it and try again.';
  if (/secure|https/i.test(msg)) return 'The camera needs the app to be opened over HTTPS.';
  return "The camera couldn't start. Type the barcode or take a photo of it instead.";
}
