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
 * The register is a matrix of the squad against the week's training sessions. It is plain
 * HTML because both exporters render HTML: Expo Print builds the PDF on a phone, and the web
 * build prints the same document so "Save as PDF" produces an identical register.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_ABBREVIATION: Record<AttendanceStatus, string> = {
  present: 'P',
  late: 'L',
  absent: 'A',
  excused: 'E',
};

const STATUS_CELL: Record<AttendanceStatus, string> = {
  present: 'background:#E7F6EE;color:#0B6B3F;',
  late: 'background:#FEF3C7;color:#8A5A00;',
  absent: 'background:#FDE8E8;color:#A11B1B;',
  excused: 'background:#EEF2F7;color:#46556B;',
};

const pad = (value: number): string => String(value).padStart(2, '0');

const escapeHtml = (value: string): string => {
  let out = '';
  for (const char of value) {
    switch (char) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      case "'":
        out += '&#39;';
        break;
      default:
        out += char;
    }
  }
  return out;
};

/** English on purpose: the PDF must not change wording with the phone's locale. */
export function sessionLabel(iso: string): string {
  const date = parseIso(iso);
  const month = MONTHS[date.getMonth()] ?? '';
  return `${WEEKDAYS[date.getDay()] ?? ''} ${date.getDate()} ${month}`.toUpperCase();
}

const formatGeneratedAt = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

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

export const attendanceRegisterTitle = (teamName: string, weekStart: string): string =>
  `Clubstride Attendance - ${teamName} - week of ${weekStart}`;

export function buildAttendanceRegisterHtml(input: AttendanceRegisterInput): string {
  const { teamName, weekStart, trainingDays, sessions, players, records } = input;
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
  const rate = attendanceRate(totals);
  const marked = totals.total - totals.unmarked;
  const title = attendanceRegisterTitle(teamName, weekStart);

  const headCells = sessions
    .map(date => `<th class="session">${escapeHtml(sessionLabel(date))}</th>`)
    .join('');

  const bodyRows = players
    .map(player => {
      const marks = sessions
        .map(date => {
          const entry = records[attendanceKey(player.id, date)];
          if (!entry) return '<td class="mark unmarked">-</td>';
          return `<td class="mark" style="${STATUS_CELL[entry.status]}">${STATUS_ABBREVIATION[entry.status]}</td>`;
        })
        .join('');
      const position = player.position_tag ? `<span class="position">${escapeHtml(player.position_tag)}</span>` : '';
      return `
        <tr>
          <td class="player">
            <span class="shirt">#${player.shirt_number}</span>
            <span class="name">${escapeHtml(player.full_name)}</span>
            ${position}
          </td>
          ${marks}
        </tr>`;
    })
    .join('');

  const summaryRows = sessions
    .map((date, index) => {
      const counts = sessionCounts[index];
      if (!counts) return '';
      const sessionRate = attendanceRate(counts);
      const suffix = sessionRate === null ? '' : ` - ${sessionRate}% attended`;
      return `<li><strong>${escapeHtml(sessionLabel(date))}</strong><span>${escapeHtml(describeCounts(counts))}${suffix}</span></li>`;
    })
    .join('');

  const emptyNote =
    sessions.length === 0
      ? '<p class="empty">No training days are set for this week, so there are no sessions to register.</p>'
      : players.length === 0
        ? '<p class="empty">No players are visible to this account, so the register has no rows.</p>'
        : '';

  const table =
    sessions.length > 0 && players.length > 0
      ? `
        <table>
          <thead>
            <tr>
              <th class="player">Player</th>
              ${headCells}
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>`
      : emptyNote;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #0B1B33;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet { max-width: 186mm; margin: 0 auto; padding: 6mm 0; }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    border-bottom: 2px solid #0B8F55;
    padding-bottom: 10px;
    margin-bottom: 14px;
  }
  .brand { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; color: #5B677A; text-transform: uppercase; }
  .brand span { color: #0B8F55; }
  h1 { margin: 3px 0 0; font-size: 22px; letter-spacing: -0.3px; color: #0B1B33; }
  .meta { text-align: right; line-height: 1.45; color: #5B677A; }
  .meta .team { color: #0B1B33; font-size: 14px; font-weight: 700; }
  .meta .generated { margin-top: 3px; font-size: 9px; color: #8391A3; }
  .facts {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
  }
  .fact {
    flex: 1;
    border: 1px solid #D0D8E2;
    border-radius: 10px;
    background: #F8FAFC;
    padding: 8px 10px;
  }
  .fact b { display: block; font-size: 17px; color: #0B1B33; font-variant-numeric: tabular-nums; }
  .fact span { color: #5B677A; font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; }
  table { width: 100%; border-collapse: collapse; background: #ffffff; }
  thead { display: table-header-group; }
  th {
    background: #0B1B33;
    color: #ffffff;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 7px 6px;
    text-align: center;
    border: 1px solid #0B1B33;
  }
  th.player, td.player { text-align: left; width: 32%; }
  tr { page-break-inside: avoid; }
  td { border: 1px solid #E1E7EF; padding: 6px; }
  td.player { white-space: nowrap; }
  .shirt {
    display: inline-block;
    min-width: 22px;
    padding: 1px 5px;
    margin-right: 6px;
    border-radius: 9999px;
    background: #0B1B33;
    color: #ffffff;
    font-size: 9px;
    font-weight: 700;
    text-align: center;
  }
  .name { font-weight: 700; color: #0B1B33; }
  .position { margin-left: 6px; color: #8391A3; font-size: 9px; }
  .mark { text-align: center; font-family: 'Courier New', monospace; font-weight: 700; font-size: 11px; }
  .mark.unmarked { color: #A9B4C2; }
  .summary { margin-top: 16px; page-break-inside: avoid; }
  h2 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #303A4A; margin: 0 0 6px; }
  ul { list-style: none; margin: 0; padding: 0; border: 1px solid #E1E7EF; border-radius: 10px; overflow: hidden; }
  li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 10px; border-bottom: 1px solid #E1E7EF; }
  li:last-child { border-bottom: 0; }
  li strong { color: #0B1B33; font-size: 10px; }
  li span { color: #5B677A; font-size: 10px; }
  .legend { margin-top: 10px; color: #5B677A; font-size: 9px; }
  .legend b { color: #0B1B33; }
  .empty { padding: 18px; border: 1px dashed #D0D8E2; border-radius: 10px; color: #5B677A; text-align: center; }
  footer {
    margin-top: 18px;
    border-top: 1px solid #E6EBF1;
    padding-top: 8px;
    display: flex;
    justify-content: space-between;
    color: #8391A3;
    font-size: 9px;
  }
</style>
</head>
<body>
  <div class="sheet">
    <header>
      <div>
        <div class="brand">Clubstride <span>Pro</span></div>
        <h1>Attendance Register</h1>
      </div>
      <div class="meta">
        <div class="team">${escapeHtml(teamName)}</div>
        <div>Week of ${escapeHtml(weekStart)}</div>
        <div>Training days: ${escapeHtml(formatTrainingDays(trainingDays))}</div>
        <div class="generated">Generated ${formatGeneratedAt(generatedAt)}</div>
      </div>
    </header>

    <div class="facts">
      <div class="fact"><b>${sessions.length}</b><span>Session${sessions.length === 1 ? '' : 's'}</span></div>
      <div class="fact"><b>${players.length}</b><span>Players</span></div>
      <div class="fact"><b>${marked}/${totals.total}</b><span>Marks recorded</span></div>
      <div class="fact"><b>${rate === null ? '-' : `${rate}%`}</b><span>Attendance</span></div>
    </div>

    ${table}

    ${
      sessions.length > 0 && players.length > 0
        ? `
        <div class="summary">
          <h2>Session summary</h2>
          <ul>${summaryRows}</ul>
        </div>
        <div class="legend"><b>P</b> Present &bull; <b>L</b> Late &bull; <b>A</b> Absent &bull; <b>E</b> Excused &bull; <b>-</b> Not marked. Attendance counts Present and Late among marked players.</div>`
        : ''
    }

    <footer>
      <span>Clubstride Pro &bull; Attendance register &bull; ${escapeHtml(formatWeekRangeLabel(weekStart))}</span>
      <span>Attendance is taken per training session</span>
    </footer>
  </div>
</body>
</html>`;
}

const formatWeekRangeLabel = (weekStart: string): string => {
  const start = parseIso(weekStart);
  const end = parseIso(weekStart);
  end.setDate(end.getDate() + 6);
  const endMonth = MONTHS[end.getMonth()] ?? '';
  return `${start.getDate()} ${MONTHS[start.getMonth()] ?? ''} - ${end.getDate()} ${endMonth}`;
};
