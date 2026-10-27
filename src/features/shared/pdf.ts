/**
 * Low-level PDF 1.4 writing shared by the attendance register and the player report.
 *
 * The documents are drawn directly instead of being printed by a WebView: Expo Print on
 * Android produced page-less files for the register even though the same HTML prints in Blink.
 * Coordinates are PDF points, origin bottom-left; text is standard Helvetica, WinAnsi encoded.
 */

export const PAGE_WIDTH = 595; // A4 at 72 dpi
export const PAGE_HEIGHT = 842;

export type Font = 'F1' | 'F2' | 'F3';

/** WinAnsi covers the club's Latin names; other scripts fall back to a question mark. */
const WIN_ANSI_SPECIAL: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  'ƒ': 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  'ˆ': 0x88,
  '‰': 0x89,
  'Š': 0x8a,
  '‹': 0x8b,
  'Œ': 0x8c,
  'Ž': 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  'š': 0x9a,
  '›': 0x9b,
  'œ': 0x9c,
  'ž': 0x9e,
  'Ÿ': 0x9f,
};

export const encodeText = (value: string): string => {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0x3f;
    let byte = 0x3f;
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) byte = code;
    else if (WIN_ANSI_SPECIAL[char] !== undefined) byte = WIN_ANSI_SPECIAL[char];
    else if (code >= 0x300 && code <= 0x36f) continue; // drop combining marks
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(byte);
  }
  return out;
};

export const rgb = (hex: string): string => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `${(((value >> 16) & 255) / 255).toFixed(3)} ${(((value >> 8) & 255) / 255).toFixed(3)} ${((value & 255) / 255).toFixed(3)}`;
};

export const num = (value: number): string => String(Math.round(value * 100) / 100);

export const text = (
  ops: string[],
  font: Font,
  size: number,
  x: number,
  y: number,
  value: string,
  color = '#000000',
): void => {
  if (!value) return;
  ops.push(
    `${rgb(color)} rg`,
    `BT /${font} ${size} Tf 1 0 0 1 ${num(x)} ${num(y)} Tm (${encodeText(value)}) Tj ET`,
  );
};

export const fillRect = (
  ops: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void => {
  ops.push(`${rgb(color)} rg`, `${num(x)} ${num(y)} ${num(width)} ${num(height)} re f`);
};

export const strokeRect = (
  ops: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  lineWidth = 0.75,
): void => {
  ops.push(
    `${rgb(color)} RG`,
    `${lineWidth} w`,
    `${num(x)} ${num(y)} ${num(width)} ${num(height)} re S`,
  );
};

export const line = (
  ops: string[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  lineWidth = 0.75,
): void => {
  ops.push(`${rgb(color)} RG`, `${lineWidth} w`, `${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
};

export interface Point {
  x: number;
  y: number;
}

/** One path op pair: `m` for the first vertex, `l` afterwards, closed before fill/stroke. */
const polygonPath = (points: readonly Point[]): string | null => {
  if (points.length < 3) return null;
  const [first, ...rest] = points;
  if (!first) return null;
  return `${num(first.x)} ${num(first.y)} m ${rest.map(point => `${num(point.x)} ${num(point.y)} l`).join(' ')} h`;
};

export const fillPolygon = (ops: string[], points: readonly Point[], color: string): void => {
  const path = polygonPath(points);
  if (!path) return;
  ops.push(`${rgb(color)} rg`, `${path} f`);
};

export const strokePolygon = (
  ops: string[],
  points: readonly Point[],
  color: string,
  lineWidth = 1,
): void => {
  const path = polygonPath(points);
  if (!path) return;
  ops.push(`${rgb(color)} RG`, `${lineWidth} w`, `${path} S`);
};

export const fillCircle = (ops: string[], x: number, y: number, radius: number, color: string): void => {
  // Four Bezier arcs, the standard kappa constant; avoids a fully general path parser.
  const k = 0.5523 * radius;
  ops.push(
    `${rgb(color)} rg`,
    `${num(x + radius)} ${num(y)} m`,
    `${num(x + radius)} ${num(y + k)} ${num(x + k)} ${num(y + radius)} ${num(x)} ${num(y + radius)} c`,
    `${num(x - k)} ${num(y + radius)} ${num(x - radius)} ${num(y + k)} ${num(x - radius)} ${num(y)} c`,
    `${num(x - radius)} ${num(y - k)} ${num(x - k)} ${num(y - radius)} ${num(x)} ${num(y - radius)} c`,
    `${num(x + k)} ${num(y - radius)} ${num(x + radius)} ${num(y - k)} ${num(x + radius)} ${num(y)} c f`,
  );
};

export const fit = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;

export const wrap = (value: string, maxWidth: number, size: number): string[] => {
  const max = Math.max(8, Math.floor(maxWidth / (size * 0.5)));
  const lines: string[] = [];
  let current = '';
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= max) current = candidate;
    else {
      if (current) lines.push(current);
      current = word.length > max ? `${word.slice(0, max - 1)}…` : word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
};

export const assemble = (pages: readonly string[][]): Uint8Array<ArrayBuffer> => {
  const objects: string[] = [];
  const add = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const mono = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>');

  const pageIds: number[] = [];
  for (const ops of pages) {
    const content = ops.join('\n');
    const contentId = add(`<< /Length ${content.length + 1} >>\nstream\n${content}\nendstream`);
    const pageId = add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R /F3 ${mono} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n%CLUBSTRIDE\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const startXref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF`;

  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index += 1) bytes[index] = pdf.charCodeAt(index) & 0xff;
  return bytes;
};
