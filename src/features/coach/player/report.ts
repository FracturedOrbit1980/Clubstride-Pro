import {
  CATEGORIES,
  METRICS_BY_CATEGORY,
  RATING_MAX,
  categoryAverages,
  overallAverage,
  ratingText,
  type CategoryKey,
  type Metric,
  type Scores,
} from './assessment';
import { formatMinutes, formatPercentage, type MatchMinutesSummary } from './minutes';
import { radarAngle } from './radar';
import { shareProfileWebLink } from './shareCode';
import type { AttendanceSummary } from '../attendance/attendance';
import {
  assemble,
  fillCircle,
  fillPolygon,
  fillRect,
  fit,
  line,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  strokePolygon,
  strokeRect,
  text,
  wrap,
  type Point,
} from '../../shared/pdf';

/**
 * One player's report as a PDF, drawn with the register's writer so a coach can send the whole
 * thing to a family from match day: game time, attendance, the four-axis radar, every rating,
 * the note and the code that opens the online copy. Everything is one page; a long note is
 * truncated rather than spilling, because a second page would carry the share code away from
 * the ratings.
 */

const MARGIN = 34;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const META_X = 330;

const INK = '#0B1B33';
const GREEN = '#0B8F55';
const MUTED = '#5B677A';
const FAINT = '#8391A3';
const LINE = '#E1E7EF';
const FRAME = '#D0D8E2';
const FILL = '#F8FAFC';
const RADAR_FILL = '#E3F2EA';

const COLUMN_GAP = 20;
const COLUMN_WIDTH = (CONTENT_WIDTH - COLUMN_GAP) / 2;
const RIGHT_COLUMN_X = MARGIN + COLUMN_WIDTH + COLUMN_GAP;
const BAND_ROW = 36;
const METRIC_ROW = 17;
const GROUP_HEADER = 21;
const CATEGORY_ROW = 24;
const NOTE_MAX_LINES = 7;
const NOTE_MAX_CHARS = 700;
const NOTE_CLIPPED = '... (full note in the app)';

const pad = (value: number): string => String(value).padStart(2, '0');

const formatGeneratedAt = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export interface PlayerReportInput {
  teamName: string;
  playerName: string;
  shirtNumber: string | number;
  position: string | null;
  scores: Scores;
  coachNotes: string | null;
  minutes: MatchMinutesSummary;
  attendance: AttendanceSummary;
  shareCode: string | null;
  generatedAt?: Date;
}

export const playerReportFileName = (playerName: string, generatedAt: Date): string =>
  `clubstride-player-${slug(playerName) || 'report'}-${generatedAt.getFullYear()}-${pad(generatedAt.getMonth() + 1)}-${pad(generatedAt.getDate())}.pdf`;

const drawHeader = (
  ops: string[],
  input: PlayerReportInput,
  generatedAt: Date,
  overall: number | null,
): void => {
  const top = PAGE_HEIGHT - MARGIN;
  text(ops, 'F2', 10, MARGIN, top - 4, 'CLUBSTRIDE', MUTED);
  text(ops, 'F2', 10, MARGIN + 70, top - 4, 'PRO', GREEN);
  text(ops, 'F2', 22, MARGIN, top - 32, 'Player Report', INK);

  text(ops, 'F2', 14, META_X, top - 2, fit(input.teamName, 30), INK);
  text(ops, 'F1', 9, META_X, top - 17, `Generated ${formatGeneratedAt(generatedAt)}`, FAINT);
  line(ops, MARGIN, top - 56, MARGIN + CONTENT_WIDTH, top - 56, GREEN, 2);

  // Player lock-up: shirt number disc, name and position, overall box on the right.
  const centreY = top - 88;
  fillCircle(ops, MARGIN + 17, centreY, 17, GREEN);
  text(ops, 'F2', 15, MARGIN + 10, centreY - 5.5, String(input.shirtNumber), '#FFFFFF');
  text(ops, 'F2', 18, MARGIN + 44, centreY + 2, fit(input.playerName, 34), INK);
  text(ops, 'F1', 10, MARGIN + 44, centreY - 12, input.position ?? 'No position set', MUTED);

  const boxWidth = 78;
  const boxX = MARGIN + CONTENT_WIDTH - boxWidth;
  fillRect(ops, boxX, centreY - 18, boxWidth, 36, FILL);
  strokeRect(ops, boxX, centreY - 18, boxWidth, 36, FRAME);
  text(ops, 'F2', 17, boxX + 10, centreY - 4, ratingText(overall), INK);
  text(ops, 'F1', 7, boxX + 10, centreY - 14, 'OVERALL', MUTED);
};

const drawBand = (ops: string[], top: number, cells: readonly (readonly [string, string])[], size: number): void => {
  const gap = cells.length > 4 ? 6 : 8;
  const width = (CONTENT_WIDTH - gap * (cells.length - 1)) / cells.length;
  cells.forEach(([value, label], index) => {
    const x = MARGIN + index * (width + gap);
    fillRect(ops, x, top - BAND_ROW, width, BAND_ROW, FILL);
    strokeRect(ops, x, top - BAND_ROW, width, BAND_ROW, FRAME);
    text(ops, 'F2', size, x + 9, top - 15, value, INK);
    text(ops, 'F1', 6.5, x + 9, top - 27, label, MUTED);
  });
};

const drawFacts = (ops: string[], top: number, input: PlayerReportInput): void => {
  const minutes = input.minutes;
  drawBand(ops, top, [
    [formatPercentage(minutes.percentage), 'GAME TIME'],
    [formatMinutes(minutes.playedSeconds), 'MINUTES PLAYED'],
    [formatMinutes(minutes.totalSeconds), 'MATCH MINUTES'],
    [`${minutes.matchesPlayed}/${minutes.matches}`, 'MATCHES PLAYED'],
  ], 15);
};

/** Present and late count as attended, so the band and the register's rate never disagree. */
const drawAttendance = (ops: string[], top: number, attendance: AttendanceSummary): void => {
  if (attendance.sessions === 0) {
    fillRect(ops, MARGIN, top - BAND_ROW, CONTENT_WIDTH, BAND_ROW, FILL);
    strokeRect(ops, MARGIN, top - BAND_ROW, CONTENT_WIDTH, BAND_ROW, FRAME);
    text(ops, 'F1', 9, MARGIN + 12, top - 21, 'No attendance marked yet.', MUTED);
    return;
  }
  const dash = (value: number | null): string => (value === null ? '-' : `${value}%`);
  drawBand(ops, top, [
    [`${attendance.attended}/${attendance.sessions}`, 'ATTENDED'],
    [dash(attendance.rate), 'ATTENDANCE'],
    [String(attendance.present), 'PRESENT'],
    [String(attendance.late), 'LATE'],
    [String(attendance.absent), 'ABSENT'],
    [String(attendance.excused), 'EXCUSED'],
  ], 13);
};

const radarPoints = (
  values: readonly (number | null)[],
  centre: Point,
  radius: number,
): Point[] =>
  values.map((value, index) => {
    const fraction = value === null ? 0 : Math.min(1, Math.max(0, value / RATING_MAX));
    const radians = (radarAngle(index, values.length) * Math.PI) / 180;
    return {
      x: centre.x + radius * fraction * Math.cos(radians),
      y: centre.y - radius * fraction * Math.sin(radians),
    };
  });

const textWidth = (value: string, size: number): number => value.length * size * 0.52;

const drawRadar = (ops: string[], top: number, values: readonly (number | null)[]): void => {
  const centre: Point = { x: MARGIN + 118, y: top - 100 };
  const radius = 58;
  const labels = CATEGORIES.map(category => category.label);
  const ring = (fraction: number): Point[] =>
    labels.map((_, index) => {
      const radians = (radarAngle(index, labels.length) * Math.PI) / 180;
      return {
        x: centre.x + radius * fraction * Math.cos(radians),
        y: centre.y - radius * fraction * Math.sin(radians),
      };
    });

  for (const fraction of [0.2, 0.4, 0.6, 0.8, 1]) strokePolygon(ops, ring(fraction), LINE, 0.6);
  const outer = ring(1);
  for (const point of outer) line(ops, centre.x, centre.y, point.x, point.y, LINE, 0.6);

  const plotted = radarPoints(values, centre, radius);
  fillPolygon(ops, plotted, RADAR_FILL);
  strokePolygon(ops, plotted, GREEN, 1.2);
  for (const point of plotted) fillCircle(ops, point.x, point.y, 2.2, GREEN);

  labels.forEach((label, index) => {
    const radians = (radarAngle(index, labels.length) * Math.PI) / 180;
    const anchor = {
      x: centre.x + (radius + 10) * Math.cos(radians),
      y: centre.y - (radius + 10) * Math.sin(radians),
    };
    const horizontal = Math.cos(radians);
    const width = textWidth(label, 8);
    const x = Math.abs(horizontal) < 0.2 ? anchor.x - width / 2 : horizontal > 0 ? anchor.x : anchor.x - width;
    text(ops, 'F1', 8, x, anchor.y + 2.6, label, MUTED);
  });
};

const drawCategoryValues = (ops: string[], top: number, averages: Record<CategoryKey, number | null>): void => {
  const x = RIGHT_COLUMN_X;
  const width = COLUMN_WIDTH;
  CATEGORIES.forEach((category, index) => {
    const y = top - 10 - index * CATEGORY_ROW;
    fillRect(ops, x, y - 6, width, 22, index % 2 === 0 ? FILL : '#FFFFFF');
    text(ops, 'F1', 9.5, x + 8, y + 3, category.label, MUTED);
    text(ops, 'F2', 10, x + width - 30, y + 3, ratingText(averages[category.key]), INK);
  });
};

const drawMetricRow = (
  ops: string[],
  x: number,
  y: number,
  width: number,
  label: string,
  value: number | null,
): void => {
  text(ops, 'F1', 8.5, x, y, fit(label, 30), INK);
  text(ops, 'F2', 8.5, x + width - 26, y, ratingText(value), INK);
  const trackY = y - 5;
  const trackWidth = 92;
  fillRect(ops, x, trackY, trackWidth, 3, LINE);
  fillRect(ops, x, trackY, (trackWidth * Math.min(RATING_MAX, value ?? 0)) / RATING_MAX, 3, GREEN);
};

const drawRatings = (ops: string[], top: number, scores: Scores): void => {
  const averages = categoryAverages(scores);
  text(ops, 'F2', 13, MARGIN, top, 'Ratings', INK);
  text(ops, 'F1', 7.5, MARGIN + 58, top + 1, '1 = needs work, 5 = strength. A dash means not rated yet.', MUTED);

  const columns: Array<{ x: number; groups: readonly { key: CategoryKey; label: string; metrics: readonly Metric[] }[] }> = [
    { x: MARGIN, groups: METRICS_BY_CATEGORY.slice(0, 2) },
    { x: RIGHT_COLUMN_X, groups: METRICS_BY_CATEGORY.slice(2) },
  ];

  for (const column of columns) {
    let y = top - 22;
    for (const group of column.groups) {
      text(ops, 'F2', 8.5, column.x, y, group.label.toUpperCase(), GREEN);
      text(ops, 'F2', 8.5, column.x + COLUMN_WIDTH - 26, y, ratingText(averages[group.key]), GREEN);
      y -= GROUP_HEADER;
      for (const metric of group.metrics) {
        drawMetricRow(ops, column.x, y, COLUMN_WIDTH, metric.label, scores[metric.key] ?? null);
        y -= METRIC_ROW;
      }
      y -= 6;
    }
  }
};

const drawNote = (ops: string[], top: number, note: string | null): void => {
  text(ops, 'F2', 11, MARGIN, top, 'Coach note', INK);
  const value = note?.trim() ?? '';
  if (!value) {
    text(ops, 'F1', 8.5, MARGIN, top - 16, 'No coach note yet.', MUTED);
    return;
  }
  const lines = wrap(
    value.length > NOTE_MAX_CHARS ? `${value.slice(0, NOTE_MAX_CHARS)} ${NOTE_CLIPPED}` : value,
    CONTENT_WIDTH,
    8.5,
  );
  const shown = lines.slice(0, NOTE_MAX_LINES);
  if (lines.length > NOTE_MAX_LINES) {
    shown[NOTE_MAX_LINES - 1] = fit(`${shown[NOTE_MAX_LINES - 1] ?? ''} ${NOTE_CLIPPED}`, 118);
  }
  shown.forEach((line, index) => text(ops, 'F1', 8.5, MARGIN, top - 16 - index * 10.5, line, INK));
};

const drawShare = (ops: string[], top: number, input: PlayerReportInput): void => {
  const height = 54;
  fillRect(ops, MARGIN, top - height, CONTENT_WIDTH, height, FILL);
  strokeRect(ops, MARGIN, top - height, CONTENT_WIDTH, height, FRAME);
  text(ops, 'F2', 9, MARGIN + 12, top - 16, 'View this report online', INK);
  if (!input.shareCode) {
    text(ops, 'F1', 7.5, MARGIN + 12, top - 32, 'No share code has been issued for this player yet.', MUTED);
    return;
  }
  text(ops, 'F1', 7.5, MARGIN + 12, top - 32, 'Code', MUTED);
  text(ops, 'F3', 10, MARGIN + 38, top - 32, input.shareCode, GREEN);
  text(ops, 'F1', 7.5, MARGIN + 12, top - 45, fit(shareProfileWebLink(input.shareCode), 96), MUTED);
};

const drawFooter = (ops: string[], input: PlayerReportInput): void => {
  line(ops, MARGIN, 30, MARGIN + CONTENT_WIDTH, 30, FRAME, 0.6);
  text(ops, 'F1', 7.5, MARGIN, 18, `Clubstride Pro player report - ${fit(input.teamName, 40)}`, FAINT);
  text(ops, 'F1', 7.5, MARGIN + CONTENT_WIDTH - 40, 18, 'Page 1 of 1', FAINT);
};

export function buildPlayerReportPdf(input: PlayerReportInput): Uint8Array<ArrayBuffer> {
  const generatedAt = input.generatedAt ?? new Date();
  const ops: string[] = [];
  const overall = overallAverage(input.scores);
  const averages = categoryAverages(input.scores);

  drawHeader(ops, input, generatedAt, overall);
  drawFacts(ops, PAGE_HEIGHT - MARGIN - 110, input);
  drawAttendance(ops, PAGE_HEIGHT - MARGIN - 152, input.attendance);
  text(ops, 'F2', 13, MARGIN, PAGE_HEIGHT - MARGIN - 212, 'Rating profile', INK);
  drawRadar(ops, PAGE_HEIGHT - MARGIN - 204, CATEGORIES.map(category => averages[category.key]));
  drawCategoryValues(ops, PAGE_HEIGHT - MARGIN - 204, averages);
  drawRatings(ops, PAGE_HEIGHT - MARGIN - 388, input.scores);
  drawNote(ops, PAGE_HEIGHT - MARGIN - 622, input.coachNotes);
  drawShare(ops, PAGE_HEIGHT - MARGIN - 712, input);
  drawFooter(ops, input);

  return assemble([ops]);
}
