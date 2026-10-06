/**
 * UUIDv7: time-ordered, so ids sort by creation and SQLite's primary-key
 * B-tree appends instead of scattering inserts. Generated on the client for
 * messages and generations so a send is idempotent across retries (D2).
 * Works in browsers and Node; the only dependency is `crypto.getRandomValues`.
 */
let lastMs = 0;
let seq = 0;

export function uuidv7(now: number = Date.now()): string {
  // Monotonic within a process: bump the 12-bit sequence when the ms repeats.
  if (now === lastMs) {
    seq = (seq + 1) & 0xfff;
  } else {
    lastMs = now;
    seq = Math.floor(Math.random() * 0x1000);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // 48-bit timestamp, big-endian.
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  // version 7 in the high nibble, then the sequence in the remaining 12 bits.
  bytes[6] = 0x70 | ((seq >> 8) & 0x0f);
  bytes[7] = seq & 0xff;
  // RFC 4122 variant.
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
