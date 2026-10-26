import {
  attendanceKey,
  attendanceRate,
  countStatuses,
  describeCounts,
  type AttendanceMap,
  type AttendanceStatus,
  type StatusCounts,
} from './attendance';
import type { SquadPlayerRow } from './squad';
import { formatTrainingDays, type TrainingWeekday } from './trainingDays';
import { parseIso } from './week';

/**
 * The register is written as a PDF here instead of being printed by a WebView. Expo Print on
 * Android laid out no pages for this document even though the same HTML prints in Blink, and a
 * blank file reached the share sheet. Drawing the document directly keeps the export independent
 * of the platform's print engine, so the phone and the browser produce the same file.
 */

const PAGE_WIDTH = 595; // A4 at 72 dpi
const PAGE_HEIGHT = 842;
const MARGIN = 34;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const PLAYER_COLUMN = 200;
const META_X = 330;
const ROW_HEIGHT = 24;
const TABLE_HEADER_HEIGHT = 30;
const ROW_BOTTOM = 60;
const FOOTER_LINE_Y = 44;

const INK = '#0B1B33';
const GREEN = '#0B8F55';
const MUTED = '#5B677A';
const FAINT = '#8391A3';
const LINE = '#E1E7EF';
const FRAME = '#D0D8E2';
const FILL = '#F8FAFC';
const UNMARKED = '#A9B4C2';

const STATUS_FILL: Record<AttendanceStatus, string> = {
  present: '#E7F6EE',
  late: '#FEF3C7',
  absent: '#FDE8E8',
  excused: '#EEF2F7',
};

const STATUS_INK: Record<AttendanceStatus, string> = {
  present: '#0B6B3F',
  late: '#8A5A00',
  absent: '#A11B1B',
  excused: '#46556B',
};

const STATUS_ABBREVIATION: Record<AttendanceStatus, string> = {
  present: 'P',
  late: 'L',
  absent: 'A',
  excused: 'E',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Font = 'F1' | 'F2' | 'F3';

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

const encodeText = (value: string): string => {
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

const rgb = (hex: string): string => {
  const value = Number.parseInt(hex.slice(1), 16);
  return `${(((value >> 16) & 255) / 255).toFixed(3)} ${(((value >> 8) & 255) / 255).toFixed(3)} ${((value & 255) / 255).toFixed(3)}`;
};

const num = (value: number): string => String(Math.round(value * 100) / 100);

const text = (
  ops: string[],
  font: Font,
  size: number,
  x: number,
  y: number,
  value: string,
  color = INK,
): void => {
  if (!value) return;
  ops.push(
    `${rgb(color)} rg`,
    `BT /${font} ${size} Tf 1 0 0 1 ${num(x)} ${num(y)} Tm (${encodeText(value)}) Tj ET`,
  );
};

const fillRect = (
  ops: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void => {
  ops.push(`${rgb(color)} rg`, `${num(x)} ${num(y)} ${num(width)} ${num(height)} re f`);
};

const strokeRect = (
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

const line = (
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

const fit = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;

const wrap = (value: string, maxWidth: number, size: number): string[] => {
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

const pad = (value: number): string => String(value).padStart(2, '0');

const sessionParts = (iso: string): { day: string; date: string } => {
  const date = parseIso(iso);
  return {
    day: (WEEKDAYS[date.getDay()] ?? '').toUpperCase(),
    date: `${date.getDate()} ${(MONTHS[date.getMonth()] ?? '').toUpperCase()}`,
  };
};

const formatGeneratedAt = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

const formatWeekRange = (weekStart: string): string => {
  const start = parseIso(weekStart);
  const end = parseIso(weekStart);
  end.setDate(end.getDate() + 6);
  return `${start.getDate()} ${MONTHS[start.getMonth()] ?? ''} - ${end.getDate()} ${MONTHS[end.getMonth()] ?? ''}`;
};

const addCounts = (left: StatusCounts, right: StatusCounts): StatusCounts => ({
  present: left.present + right.present,
  late: left.late + right.late,
  absent: left.absent + right.absent,
  excused: left.excused + right.excused,
  unmarked: left.unmarked + right.unmarked,
  total: left.total + right.total,
});

export interface AttendanceRegisterInput {
  teamName: string;
  weekStart: string;
  trainingDays: readonly TrainingWeekday[];
  sessions: readonly string[];
  players: readonly SquadPlayerRow[];
  records: AttendanceMap;
  generatedAt?: Date;
}

export const attendanceRegisterFileName = (teamName: string, weekStart: string): string => {
  const slug = teamName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `clubstride-attendance-${slug || 'register'}-${weekStart}.pdf`;
};

interface Page {
  ops: string[];
}

interface Totals {
  sessionCounts: StatusCounts[];
  totals: StatusCounts;
  rate: number | null;
  marked: number;
  playerCount: number;
}

const drawCoverHeader = (
  page: Page,
  input: AttendanceRegisterInput,
  values: Totals,
  generatedAt: Date,
): number => {
  const top = PAGE_HEIGHT - MARGIN;
  const ops = page.ops;
  text(ops, 'F2', 10, MARGIN, top - 4, 'CLUBSTRIDE', MUTED);
  text(ops, 'F2', 10, MARGIN + 70, top - 4, 'PRO', GREEN);
  text(ops, 'F2', 22, MARGIN, top - 32, 'Attendance Register', INK);

  text(ops, 'F2', 14, META_X, top - 2, fit(input.teamName, 26), INK);
  text(ops, 'F1', 10, META_X, top - 18, `Week of ${input.weekStart}`, MUTED);
  text(ops, 'F1', 10, META_X, top - 32, `Training days: ${formatTrainingDays(input.trainingDays)}`, MUTED);
  text(ops, 'F1', 8.5, META_X, top - 46, `Generated ${formatGeneratedAt(generatedAt)}`, FAINT);

  line(ops, MARGIN, top - 56, MARGIN + CONTENT_WIDTH, top - 56, GREEN, 2);
  return drawFacts(page, top - 70, values);
};

const drawContinuedHeader = (page: Page, input: AttendanceRegisterInput): number => {
  const top = PAGE_HEIGHT - MARGIN;
  const ops = page.ops;
  text(ops, 'F2', 9, MARGIN, top - 4, 'CLUBSTRIDE', MUTED);
  text(ops, 'F2', 9, MARGIN + 63, top - 4, 'PRO', GREEN);
  text(ops, 'F2', 14, MARGIN, top - 24, 'Attendance Register (continued)', INK);
  text(ops, 'F1', 9, META_X, top - 4, fit(input.teamName, 26), MUTED);
  text(ops, 'F1', 9, META_X, top - 16, `Week of ${input.weekStart}`, FAINT);
  line(ops, MARGIN, top - 34, MARGIN + CONTENT_WIDTH, top - 34, GREEN, 1.5);
  return top - 44;
};

const drawFacts = (page: Page, top: number, values: Totals): number => {
  const gap = 8;
  const width = (CONTENT_WIDTH - gap * 3) / 4;
  const facts: Array<[string, string]> = [
    [String(values.sessionCounts.length), `SESSION${values.sessionCounts.length === 1 ? '' : 'S'}`],
    [String(values.playerCount), 'PLAYERS'],
    [`${values.marked}/${values.totals.total}`, 'MARKS RECORDED'],
    [values.rate === null ? '-' : `${values.rate}%`, 'ATTENDANCE'],
  ];
  facts.forEach(([value, label], index) => {
    const x = MARGIN + index * (width + gap);
    fillRect(page.ops, x, top - 44, width, 44, FILL);
    strokeRect(page.ops, x, top - 44, width, 44, FRAME);
    text(page.ops, 'F2', 17, x + 10, top - 19, value, INK);
    text(page.ops, 'F1', 8, x + 10, top - 33, label, MUTED);
  });
  return top - 58;
};

const drawTableHeader = (page: Page, top: number, sessions: readonly string[]): number => {
  const ops = page.ops;
  const columnWidth = sessions.length > 0 ? (CONTENT_WIDTH - PLAYER_COLUMN) / sessions.length : 0;
  fillRect(ops, MARGIN, top - TABLE_HEADER_HEIGHT, CONTENT_WIDTH, TABLE_HEADER_HEIGHT, INK);
  text(ops, 'F2', 8.5, MARGIN + 8, top - 19, 'PLAYER', '#FFFFFF');
  sessions.forEach((iso, index) => {
    const x = MARGIN + PLAYER_COLUMN + index * columnWidth;
    if (index > 0) line(ops, x, top, x, top - TABLE_HEADER_HEIGHT, '#33445F');
    const parts = sessionParts(iso);
    text(ops, 'F2', 9, x + 6, top - 12, parts.day, '#FFFFFF');
    text(ops, 'F1', 8, x + 6, top - 23, parts.date, '#FFFFFF');
  });
  return top - TABLE_HEADER_HEIGHT;
};

const drawRow = (
  page: Page,
  top: number,
  player: SquadPlayerRow,
  sessions: readonly string[],
  records: AttendanceMap,
): void => {
  const ops = page.ops;
  const bottom = top - ROW_HEIGHT;
  const columnWidth = sessions.length > 0 ? (CONTENT_WIDTH - PLAYER_COLUMN) / sessions.length : 0;

  line(ops, MARGIN, top, MARGIN + CONTENT_WIDTH, top, LINE);
  line(ops, MARGIN + PLAYER_COLUMN, top, MARGIN + PLAYER_COLUMN, bottom, LINE);

  const badgeWidth = 26;
  fillRect(ops, MARGIN + 6, bottom + 6, badgeWidth, 12, INK);
  const shirt = `#${player.shirt_number}`;
  text(ops, 'F2', 9, MARGIN + 6 + (badgeWidth - shirt.length * 5) / 2, bottom + 15.2, shirt, '#FFFFFF');
  text(ops, 'F2', 9.5, MARGIN + 38, bottom + 15, fit(player.full_name, 30), INK);
  if (player.position_tag) {
    text(ops, 'F1', 8, MARGIN + 38, bottom + 5.5, fit(player.position_tag.toUpperCase(), 24), FAINT);
  }

  sessions.forEach((iso, index) => {
    const x = MARGIN + PLAYER_COLUMN + index * columnWidth;
    if (index > 0) line(ops, x, top, x, bottom, LINE);
    const entry = records[attendanceKey(player.id, iso)];
    if (!entry) {
      text(ops, 'F3', 11, x + (columnWidth - 6.6) / 2, bottom + 8, '-', UNMARKED);
      return;
    }
    fillRect(ops, x + 0.75, bottom + 0.75, columnWidth - 1.5, ROW_HEIGHT - 1.5, STATUS_FILL[entry.status]);
    text(
      ops,
      'F3',
      11,
      x + (columnWidth - 6.6) / 2,
      bottom + 8,
      STATUS_ABBREVIATION[entry.status],
      STATUS_INK[entry.status],
    );
  });

  line(ops, MARGIN, bottom, MARGIN + CONTENT_WIDTH, bottom, LINE);
};

const drawEmptyNote = (page: Page, top: number, message: string): number => {
  const lines = wrap(message, CONTENT_WIDTH - 32, 10);
  const height = 20 + lines.length * 13;
  fillRect(page.ops, MARGIN, top - height, CONTENT_WIDTH, height, FILL);
  strokeRect(page.ops, MARGIN, top - height, CONTENT_WIDTH, height, FRAME);
  lines.forEach((value, index) => {
    text(page.ops, 'F1', 10, MARGIN + 16, top - 18 - index * 13, value, MUTED);
  });
  return top - height;
};

const drawSummary = (
  page: Page,
  top: number,
  input: AttendanceRegisterInput,
  values: Totals,
): number => {
  const ops = page.ops;
  const headingY = top - 16;
  text(ops, 'F2', 9, MARGIN, headingY, 'SESSION SUMMARY', '#303A4A');
  let cursor = headingY - 8;
  const boxTop = cursor;
  const rowHeight = 18;
  const boxHeight = input.sessions.length * rowHeight;

  fillRect(ops, MARGIN, boxTop - boxHeight, CONTENT_WIDTH, boxHeight, '#FFFFFF');
  strokeRect(ops, MARGIN, boxTop - boxHeight, CONTENT_WIDTH, boxHeight, LINE);
  input.sessions.forEach((iso, index) => {
    const counts = values.sessionCounts[index];
    if (!counts) return;
    const rowTop = boxTop - index * rowHeight;
    if (index > 0) line(ops, MARGIN, rowTop, MARGIN + CONTENT_WIDTH, rowTop, LINE);
    const rate = attendanceRate(counts);
    const suffix = rate === null ? '' : ` - ${rate}% attended`;
    text(ops, 'F2', 10, MARGIN + 10, rowTop - 12.5, sessionLabel(iso), INK);
    text(ops, 'F1', 10, MARGIN + 210, rowTop - 12.5, `${describeCounts(counts)}${suffix}`, MUTED);
  });
  cursor = boxTop - boxHeight - 10;

  const legend =
    'P Present • L Late • A Absent • E Excused • - Not marked. Attendance counts Present and Late among marked players.';
  wrap(legend, CONTENT_WIDTH, 8.5).forEach((value, index) => {
    text(ops, 'F1', 8.5, MARGIN, cursor - 10 - index * 12, value, MUTED);
  });
  return cursor - 12 - wrap(legend, CONTENT_WIDTH, 8.5).length * 12;
};

const drawFooter = (page: Page, index: number, total: number, weekStart: string): void => {
  line(page.ops, MARGIN, FOOTER_LINE_Y, MARGIN + CONTENT_WIDTH, FOOTER_LINE_Y, '#E6EBF1', 0.5);
  text(
    page.ops,
    'F1',
    8,
    MARGIN,
    30,
    `Clubstride Pro • Attendance register • ${formatWeekRange(weekStart)}`,
    FAINT,
  );
  const label = `Page ${index + 1} of ${total}`;
  text(page.ops, 'F3', 8, MARGIN + CONTENT_WIDTH - label.length * 4.8, 30, label, FAINT);
};

const sessionLabel = (iso: string): string => {
  const parts = sessionParts(iso);
  return `${parts.day} ${parts.date}`;
};

const assemble = (pages: readonly string[][]): Uint8Array<ArrayBuffer> => {
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

export function buildAttendanceRegisterPdf(input: AttendanceRegisterInput): Uint8Array<ArrayBuffer> {
  const { teamName, weekStart, sessions, players, records } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const playerIds = players.map(player => player.id);
  const sessionCounts = sessions.map(date => countStatuses(playerIds, records, date));
  const totals = sessionCounts.reduce(addCounts, {
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
    unmarked: 0,
    total: 0,
  });
  const values: Totals = {
    sessionCounts,
    totals,
    rate: attendanceRate(totals),
    marked: totals.total - totals.unmarked,
    playerCount: players.length,
  };

  const pages: Page[] = [];
  let page: Page = { ops: [] };
  pages.push(page);
  let cursor = drawCoverHeader(page, input, values, generatedAt);

  if (sessions.length === 0 || players.length === 0) {
    cursor = drawEmptyNote(
      page,
      cursor,
      sessions.length === 0
        ? 'No training days are set for this week, so there are no sessions to register.'
        : 'No players are visible to this account, so the register has no rows.',
    );
  } else {
    cursor = drawTableHeader(page, cursor, sessions);
    for (const player of players) {
      if (cursor - ROW_HEIGHT < ROW_BOTTOM) {
        page = { ops: [] };
        pages.push(page);
        cursor = drawContinuedHeader(page, input);
        cursor = drawTableHeader(page, cursor, sessions);
      }
      drawRow(page, cursor, player, sessions, records);
      cursor -= ROW_HEIGHT;
    }

    const legendLength = wrap(
      'P Present • L Late • A Absent • E Excused • - Not marked. Attendance counts Present and Late among marked players.',
      CONTENT_WIDTH,
      8.5,
    ).length;
    const summaryHeight = 16 + 8 + sessions.length * 18 + 10 + legendLength * 12;
    if (cursor - summaryHeight < ROW_BOTTOM) {
      page = { ops: [] };
      pages.push(page);
      cursor = drawContinuedHeader(page, input);
    }
    cursor = drawSummary(page, cursor, input, values);
  }

  pages.forEach((item, index) => drawFooter(item, index, pages.length, weekStart));
  return assemble(pages.map(item => item.ops));
}
