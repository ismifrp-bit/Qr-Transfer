// qr-scanner.js — camera capture + continuous QR decoding via jsQR.
// Everything stays on-device: frames are read into a local canvas and
// never leave the browser.
'use strict';

const QrScanner = (() => {

  let stream = null;
  let videoEl = null;
  let canvasEl = null;
  let canvasCtx = null;
  let rafId = null;
  let onDecode = null;
  let currentDeviceId = null;
  let devices = [];
  let scanning = false;

  async function listCameras() {
    const all = await navigator.mediaDevices.enumerateDevices();
    devices = all.filter(d => d.kind === 'videoinput');
    return devices;
  }

  function pickRearCameraId() {
    const rear = devices.find(d => /back|rear|environment/i.test(d.label));
    return rear ? rear.deviceId : (devices[0] && devices[0].deviceId);
  }

  /**
   * Starts the camera and begins scanning. `video` and `canvas` are DOM
   * elements already in the page. `onFrameDecoded(text)` fires for every
   * QR payload found (including duplicates — de-duping is the caller's job).
   */
  async function start(video, canvas, onFrameDecoded, deviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('CAMERA_UNSUPPORTED');
    }
    videoEl = video;
    canvasEl = canvas;
    canvasCtx = canvas.getContext('2d', { willReadFrequently: true });
    onDecode = onFrameDecoded;

    await listCameras().catch(() => {});
    const constraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: 'environment' } },
      audio: false
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        throw new Error('CAMERA_DENIED');
      }
      throw new Error('CAMERA_ERROR');
    }

    currentDeviceId = deviceId || (stream.getVideoTracks()[0] && stream.getVideoTracks()[0].getSettings().deviceId);
    videoEl.srcObject = stream;
    await videoEl.play();
    scanning = true;
    tick();
  }

  function tick() {
    if (!scanning) return;
    if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
      const w = videoEl.videoWidth, h = videoEl.videoHeight;
      if (w && h) {
        canvasEl.width = w;
        canvasEl.height = h;
        canvasCtx.drawImage(videoEl, 0, 0, w, h);
        const imageData = canvasCtx.getImageData(0, 0, w, h);
        const code = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' });
        if (code && code.data) {
          onDecode(code.data, code.location);
        }
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    scanning = false;
    if (rafId) cancelAnimationFrame(rafId);
  }

  function resume() {
    if (!scanning && stream) {
      scanning = true;
      tick();
    }
  }

  async function switchCamera() {
    if (devices.length < 2) return false;
    const idx = devices.findIndex(d => d.deviceId === currentDeviceId);
    const next = devices[(idx + 1) % devices.length];
    stop();
    await start(videoEl, canvasEl, onDecode, next.deviceId);
    return true;
  }

  function stop() {
    scanning = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    if (videoEl) videoEl.srcObject = null;
  }

  return { start, pause, resume, stop, switchCamera, listCameras };
})();
