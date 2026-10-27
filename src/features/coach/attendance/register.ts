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
import {
  assemble,
  fillRect,
  fit,
  line,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  strokeRect,
  text,
  wrap,
} from '../../shared/pdf';

/**
 * The register is written as a PDF here instead of being printed by a WebView. Expo Print on
 * Android laid out no pages for this document even though the same HTML prints in Blink, and a
 * blank file reached the share sheet. Drawing the document directly keeps the export independent
 * of the platform's print engine, so the phone and the browser produce the same file.
 */

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
