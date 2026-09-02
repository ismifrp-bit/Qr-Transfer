// compression.js — optional gzip via the native CompressionStream API.
// Falls back to "no compression" transparently on unsupported browsers.
'use strict';

const CompressionUtil = (() => {

  const supported = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

  async function streamAll(readable) {
    const reader = readable.getReader();
    const parts = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) { out.set(p, offset); offset += p.length; }
    return out;
  }

  async function gzip(bytes) {
    if (!supported) return bytes;
    const cs = new CompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return streamAll(stream);
  }

  async function gunzip(bytes) {
    if (!supported) return bytes;
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return streamAll(stream);
  }

  return { supported, gzip, gunzip };
})();
