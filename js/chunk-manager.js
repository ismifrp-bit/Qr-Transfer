// chunk-manager.js — the QRT1 wire format.
//
// Header packet (chunk 0):  QRT1|H|<transferId>|<totalChunks>|<crc32>|<base64(json metadata)>
// Data packet   (chunk N):  QRT1|D|<transferId>|<index>|<totalChunks>|<crc32>|<base64 payload>
//
// A pipe-delimited header keeps per-packet overhead small so more of each
// QR code's capacity goes to real payload. Metadata (filename, size, mime,
// sha256, encryption params) rides once in the header packet rather than
// being repeated in every frame.
'use strict';

const ChunkManager = (() => {

  const MAGIC = 'QRT1';

  function buildHeaderPacket(transferId, totalChunks, metadata) {
    const json = JSON.stringify(metadata);
    const payload = Utils.strToBase64(json);
    const crc = Utils.crc32Hex(new TextEncoder().encode(json));
    return `${MAGIC}|H|${transferId}|${totalChunks}|${crc}|${payload}`;
  }

  function buildDataPacket(transferId, index, totalChunks, chunkBytes) {
    const payload = Utils.bytesToBase64(chunkBytes);
    const crc = Utils.crc32Hex(chunkBytes);
    return `${MAGIC}|D|${transferId}|${index}|${totalChunks}|${crc}|${payload}`;
  }

  /**
   * Splits processed (compressed/encrypted) bytes into QR packets.
   * Returns an array of packet strings; index 0 is always the header.
   */
  function buildPackets(bytes, metadata, chunkPayloadBytes) {
    const totalDataChunks = Math.max(1, Math.ceil(bytes.length / chunkPayloadBytes));
    const totalChunks = totalDataChunks + 1; // + header
    const transferId = metadata.transferId;
    const packets = [buildHeaderPacket(transferId, totalChunks, metadata)];
    for (let i = 0; i < totalDataChunks; i++) {
      const start = i * chunkPayloadBytes;
      const slice = bytes.subarray(start, start + chunkPayloadBytes);
      packets.push(buildDataPacket(transferId, i + 1, totalChunks, slice));
    }
    return packets;
  }

  /** Parses a scanned string. Returns null if it isn't a QRT1 packet. */
  function parsePacket(raw) {
    if (typeof raw !== 'string' || !raw.startsWith(MAGIC + '|')) return null;
    const parts = raw.split('|');
    if (parts.length < 6) return null;
    const [, kind, transferId, a, b, ...rest] = parts;

    if (kind === 'H') {
      const [totalChunks, crc] = [a, b];
      const payload = rest.join('|');
      let metadata;
      try {
        const json = Utils.base64ToStr(payload);
        if (Utils.crc32Hex(new TextEncoder().encode(json)) !== crc) return { error: 'CORRUPT' };
        metadata = JSON.parse(json);
      } catch (e) {
        return { error: 'CORRUPT' };
      }
      return {
        kind: 'H', transferId, index: 0,
        totalChunks: parseInt(totalChunks, 10), metadata
      };
    }

    if (kind === 'D') {
      const [index, totalChunks, crc] = [a, b, rest[0]];
      const payload = rest.slice(1).join('|');
      let bytes;
      try {
        bytes = Utils.base64ToBytes(payload);
      } catch (e) {
        return { error: 'CORRUPT' };
      }
      if (Utils.crc32Hex(bytes) !== crc) return { error: 'CORRUPT' };
      return {
        kind: 'D', transferId,
        index: parseInt(index, 10),
        totalChunks: parseInt(totalChunks, 10),
        bytes
      };
    }

    return null;
  }

  /**
   * Tracks incoming packets for one receive session and reassembles the
   * original (still compressed/encrypted) byte stream once complete.
   */
  class ReceiverSession {
    constructor() {
      this.transferId = null;
      this.totalChunks = null;
      this.metadata = null;
      this.chunks = new Map(); // index -> Uint8Array, index 1..N (data only)
    }

    /** @returns {'HEADER'|'CHUNK'|'DUPLICATE'|'FOREIGN'|'CORRUPT'|'INVALID'} */
    ingest(raw) {
      const parsed = parsePacket(raw);
      if (!parsed) return { status: 'INVALID' };
      if (parsed.error) return { status: 'CORRUPT' };

      if (this.transferId && parsed.transferId !== this.transferId) {
        return { status: 'FOREIGN' };
      }
      if (!this.transferId) {
        this.transferId = parsed.transferId;
        this.totalChunks = parsed.totalChunks;
      }

      if (parsed.kind === 'H') {
        const wasNew = !this.metadata;
        this.metadata = parsed.metadata;
        return { status: wasNew ? 'HEADER' : 'DUPLICATE' };
      }

      if (this.chunks.has(parsed.index)) return { status: 'DUPLICATE' };
      this.chunks.set(parsed.index, parsed.bytes);
      return { status: 'CHUNK', index: parsed.index };
    }

    get dataChunkCount() {
      return this.totalChunks ? this.totalChunks - 1 : 0;
    }

    get receivedCount() {
      return this.chunks.size + (this.metadata ? 1 : 0);
    }

    isComplete() {
      if (!this.metadata || !this.totalChunks) return false;
      return this.chunks.size === this.dataChunkCount;
    }

    missingIndices() {
      const missing = [];
      const total = this.dataChunkCount;
      for (let i = 1; i <= total; i++) {
        if (!this.chunks.has(i)) missing.push(i);
      }
      return missing;
    }

    reassemble() {
      const total = this.dataChunkCount;
      let size = 0;
      for (let i = 1; i <= total; i++) size += this.chunks.get(i).length;
      const out = new Uint8Array(size);
      let offset = 0;
      for (let i = 1; i <= total; i++) {
        const c = this.chunks.get(i);
        out.set(c, offset);
        offset += c.length;
      }
      return out;
    }
  }

  return { MAGIC, buildPackets, parsePacket, ReceiverSession };
})();
