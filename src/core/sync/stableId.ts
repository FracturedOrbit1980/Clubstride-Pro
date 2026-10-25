// Deterministic row ids. Two phones that mark the same attendance session must produce the
// same primary key, or the second insert collides with attendance_one_row_per_session even
// though both coaches agree about the child. UUIDv5 over the natural key gives them one row.
//
// SHA-1 is implemented here because React Native has no crypto.subtle, the app carries no
// hash dependency, and a fabricated hash is not worth the collision risk. The harness checks
// this against the published UUIDv5 test vector.

const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const utf8 = (text: string): Uint8Array => {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
};

const rotl = (value: number, bits: number): number => ((value << bits) | (value >>> (32 - bits))) >>> 0;

function sha1(message: Uint8Array): Uint8Array {
  const paddedLength = (((message.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  // Messages in this app are short keys; the high 32 bits of the bit length stay zero.
  view.setUint32(paddedLength - 4, (message.length * 8) >>> 0);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const words = new Uint32Array(80);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 80; index += 1) {
      words[index] = rotl(
        words[index - 3]! ^ words[index - 8]! ^ words[index - 14]! ^ words[index - 16]!,
        1,
      );
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let index = 0; index < 80; index += 1) {
      let f: number;
      let k: number;
      if (index < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (index < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (index < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + words[index]!) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const digest = new Uint8Array(20);
  const digestView = new DataView(digest.buffer);
  digestView.setUint32(0, h0);
  digestView.setUint32(4, h1);
  digestView.setUint32(8, h2);
  digestView.setUint32(12, h3);
  digestView.setUint32(16, h4);
  return digest;
}

const uuidToBytes = (uuid: string): Uint8Array => {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`Not a UUID: ${uuid}`);
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

/** RFC 4122 version 5. `namespace` is the usual dashed UUID string. */
export function uuidV5(name: string, namespace: string): string {
  const namespaceBytes = uuidToBytes(namespace);
  const nameBytes = utf8(name);
  const input = new Uint8Array(namespaceBytes.length + nameBytes.length);
  input.set(namespaceBytes);
  input.set(nameBytes, namespaceBytes.length);

  const bytes = sha1(input).slice(0, 16);
  bytes[6] = ((bytes[6]! & 0x0f) | 0x50) & 0xff;
  bytes[8] = ((bytes[8]! & 0x3f) | 0x80) & 0xff;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A row id derived from the fields that identify the row. Same inputs, same uuid, on any
 * phone - which is what turns two offline copies of one attendance mark into an upsert
 * instead of a unique-constraint failure nobody at the pitch can resolve.
 */
export function stableRowId(kind: string, ...parts: string[]): string {
  return uuidV5(`${kind}:${parts.join(':')}`, DNS_NAMESPACE);
}
