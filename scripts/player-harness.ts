// Pure checks for the player assessment scale, game-time maths and share codes. Run with:
//   node scripts/run-harness.mjs
import {
  CATEGORIES,
  METRICS,
  METRICS_BY_CATEGORY,
  RATING_OPTIONS,
  categoryAverage,
  categoryAverages,
  isComplete,
  normaliseRating,
  overallAverage,
  parseScores,
  ratingText,
  scoredCount,
  serialiseScores,
  setScore,
  type Scores,
} from '../src/features/coach/player/assessment';
import {
  buildMatchLog,
  entryMinutesText,
  formatMinutes,
  formatPercentage,
  gameTimeText,
  mergeMatchLog,
  parseLineupRows,
  parseMatchRows,
  summariseMinutes,
  type LineupMinutesRow,
  type MatchMinutesRow,
  type PlayerMatchEntry,
} from '../src/features/coach/player/minutes';
import {
  assessmentPayload,
  assessmentRowId,
  parseAssessmentRow,
  pickNewerAssessment,
  toAssessmentRow,
} from '../src/features/coach/player/assessmentSync';
import {
  pointsAttribute,
  radarAngle,
  radarPoint,
  radarPoints,
  ratingFraction,
} from '../src/features/coach/player/radar';
import { assertQueuedPayload } from '../src/core/sync/contracts';
import {
  SHARE_CODE_LENGTH,
  SHARE_CODE_PATTERN,
  generateShareCode,
  isShareCode,
  normaliseShareCode,
  shareCodeFromUrl,
  shareProfileDeepLink,
  shareProfileMessage,
  shareProfileWebLink,
} from '../src/features/coach/player/shareCode';
import {
  DEMO_PLAYERS,
  DEMO_SHARE_CODE,
  demoAssessment,
  demoMatchLog,
  previewSharedPlayer,
  previewShareCode,
} from '../src/features/shared/demo';
import {
  buildPlayerReportPdf,
  playerReportFileName,
  type PlayerReportInput,
} from '../src/features/coach/player/report';
import { parseSharedProfile } from '../src/features/coach/player/sharedProfile';

async function main(): Promise<void> {
  const assert = (label: string, condition: boolean, extra?: unknown): void => {
    if (condition) {
      console.log(`ok   ${label}`);
    } else {
      console.error(`FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
      process.exitCode = 1;
    }
  };

  // --- 1. the 17 ratings ---------------------------------------------------------------

  assert(
    'four categories in reading order',
    CATEGORIES.map(category => category.key).join(',') === 'technical,physical,tactical,mental',
    CATEGORIES,
  );
  assert('seventeen metrics', METRICS.length === 17, METRICS.length);
  assert(
    'every metric key is unique',
    new Set(METRICS.map(metric => metric.key)).size === METRICS.length,
  );
  assert(
    'each category holds its own metrics',
    METRICS_BY_CATEGORY.map(group => `${group.key}:${group.metrics.length}`).join(',') ===
      'technical:5,physical:4,tactical:4,mental:4',
    METRICS_BY_CATEGORY.map(group => `${group.key}:${group.metrics.length}`),
  );
  assert(
    'every metric answers to exactly one category',
    METRICS.every(metric => CATEGORIES.some(category => category.key === metric.category)),
  );

  assert(
    'the scale offers 1 to 5 in half steps',
    RATING_OPTIONS.join(',') === '1,1.5,2,2.5,3,3.5,4,4.5,5',
    RATING_OPTIONS,
  );

  assert('a half step passes through', normaliseRating(3.5) === 3.5);
  assert('a whole number passes through', normaliseRating(2) === 2);
  assert('3.3 rounds to 3.5', normaliseRating(3.3) === 3.5, normaliseRating(3.3));
  assert('3.24 rounds to 3', normaliseRating(3.24) === 3, normaliseRating(3.24));
  assert('below the scale is refused', normaliseRating(0.5) === null);
  assert('above the scale is refused', normaliseRating(5.5) === null);
  assert('a numeric string is refused', normaliseRating('3') === null);
  assert('NaN is refused', normaliseRating(Number.NaN) === null);

  let scores: Scores = {};
  scores = setScore(scores, 'passing_accuracy', 4);
  scores = setScore(scores, 'first_touch', 3.5);
  assert('setting a score keeps an earlier one', scores.passing_accuracy === 4 && scores.first_touch === 3.5, scores);
  const cleared = setScore(scores, 'passing_accuracy', null);
  assert('setting null clears the score', cleared.passing_accuracy === undefined && cleared.first_touch === 3.5, cleared);

  const parsed = parseScores({
    passing_accuracy: 4.5,
    made_up_metric: 5,
    first_touch: 9,
    stamina: '4',
    agility: 2,
  });
  assert(
    'parsing drops unknown keys and off-scale values',
    JSON.stringify(parsed) === JSON.stringify({ passing_accuracy: 4.5, agility: 2 }),
    parsed,
  );
  assert(
    'a cleared metric leaves no stale key in the payload',
    JSON.stringify(serialiseScores({ first_touch: 3, stamina: undefined })) === JSON.stringify({ first_touch: 3 }),
    serialiseScores({ first_touch: 3, stamina: undefined }),
  );

  assert('an empty assessment has nothing scored', scoredCount({}) === 0 && isComplete({}) === false);
  const full = Object.fromEntries(METRICS.map(metric => [metric.key, 3])) as Scores;
  assert('all seventeen scores is complete', scoredCount(full) === 17 && isComplete(full));

  const mixed: Scores = { passing_accuracy: 4, dribbling_control: 3, pace_speed: 2, work_rate: 5 };
  assert('a category average ignores the other groups', categoryAverage(mixed, 'technical') === 3.5);
  assert('an unscored category has no average', categoryAverage(mixed, 'tactical') === null);
  assert(
    'all four averages read back',
    categoryAverages(mixed).physical === 2 && categoryAverages(mixed).mental === 5,
    categoryAverages(mixed),
  );
  assert('the overall average spans every score', overallAverage(mixed) === 3.5, overallAverage(mixed));
  assert('a zero score would not be mistaken for unscored', normaliseRating(0) === null);
  assert('ratings read to one decimal', ratingText(3.5) === '3.5' && ratingText(4) === '4.0');
  assert('an unscored rating is a dash', ratingText(null) === '-');

  // --- 2. game time --------------------------------------------------------------------

  const matches: MatchMinutesRow[] = [
    { id: 'm1', title: 'League', opponent_name: 'Northside', match_date: '2026-09-27', status: 'completed', duration_seconds: 3600, recorded_at: '2026-09-27T10:00:00.000Z' },
    { id: 'm2', title: 'Cup', opponent_name: 'Hillside', match_date: '2026-10-04', status: 'completed', duration_seconds: 3600, recorded_at: '2026-10-04T10:00:00.000Z' },
    { id: 'm3', title: 'League', opponent_name: 'Riverside', match_date: '2026-10-11', status: 'completed', duration_seconds: 3000, recorded_at: '2026-10-11T10:00:00.000Z' },
    { id: 'm4', title: 'League', opponent_name: 'Park', match_date: '2026-10-18', status: 'in_progress', duration_seconds: 1800, recorded_at: '2026-10-18T10:00:00.000Z' },
    { id: 'm5', title: 'League', opponent_name: 'Eastgate', match_date: '2026-10-25', status: 'completed', duration_seconds: 3600, recorded_at: '2026-10-25T10:00:00.000Z', deleted_at: '2026-10-26T10:00:00.000Z' },
  ];
  const lineup: LineupMinutesRow[] = [
    { match_id: 'm1', player_id: 'p1', listed_as: 'starter', recorded_seconds: 2700 },
    { match_id: 'm2', player_id: 'p1', listed_as: 'bench', recorded_seconds: 1200 },
    { match_id: 'm3', player_id: 'p1', listed_as: 'starter', recorded_seconds: 3000 },
    { match_id: 'm4', player_id: 'p1', listed_as: 'starter', recorded_seconds: 900 },
    { match_id: 'm5', player_id: 'p1', listed_as: 'starter', recorded_seconds: 3600 },
    { match_id: 'm1', player_id: 'p2', listed_as: 'bench', recorded_seconds: null },
    { match_id: 'm2', player_id: 'p2', listed_as: 'bench', recorded_seconds: 9999 },
  ];

  const log = buildMatchLog('p1', matches, lineup);
  assert('unfinished and deleted matches are left out', log.length === 3, log.map(entry => entry.matchId));
  assert('the log reads newest first', log.map(entry => entry.matchId).join(',') === 'm3,m2,m1', log);
  const summary = summariseMinutes(log);
  assert(
    'game time sums played against every completed match',
    summary.playedSeconds === 6900 && summary.totalSeconds === 10200 && summary.matches === 3 && summary.matchesPlayed === 3,
    summary,
  );
  assert('the percentage is played over total', summary.percentage === 6900 / 10200, summary.percentage);
  assert(
    'the shared phrase names both sides and the percentage',
    gameTimeText(summary) === '1h 55m of 2h 50m (68%)',
    gameTimeText(summary),
  );

  const bench = buildMatchLog('p2', matches, lineup);
  const benchSummary = summariseMinutes(bench);
  assert(
    'a bench player with no minutes still counts the matches',
    benchSummary.playedSeconds === 3600 && benchSummary.totalSeconds === 10200 && benchSummary.percentage === 3600 / 10200,
    benchSummary,
  );
  const clamped = bench.find(entry => entry.matchId === 'm2');
  assert('minutes past the final whistle are clamped to the match', clamped?.playedSeconds === 3600, clamped);

  const unselected = buildMatchLog('p3', matches, lineup);
  const unselectedSummary = summariseMinutes(unselected);
  assert(
    'a player with no line-up rows reads as not selected',
    unselectedSummary.playedSeconds === 0 && unselectedSummary.totalSeconds === 10200 && unselectedSummary.matchesPlayed === 0,
    unselectedSummary,
  );
  assert('not in the squad is said in words', unselected.length > 0 && entryMinutesText(unselected[0] as PlayerMatchEntry) === 'Not in the squad');
  const zeroBench = bench.find(entry => entry.matchId === 'm1');
  assert('a bench row with no minutes reads as zero', zeroBench !== undefined && entryMinutesText(zeroBench) === '0 min', zeroBench);

  const empty = summariseMinutes([]);
  assert('no matches means no percentage', empty.percentage === null && empty.totalSeconds === 0);
  assert('no matches is said in words', gameTimeText(empty) === 'No match time recorded yet');
  assert('a percentage of null is a dash', formatPercentage(null) === '-');
  assert('75 percent reads as 75%', formatPercentage(0.75) === '75%');

  assert('minutes are formatted below an hour', formatMinutes(2700) === '45 min');
  assert('seconds are rounded down to the minute', formatMinutes(2759) === '45 min');
  assert('zero minutes is still a phrase', formatMinutes(0) === '0 min');
  assert('an hour keeps two digits for the minutes', formatMinutes(3660) === '1h 01m');
  assert('a negative value is clamped to zero', formatMinutes(-60) === '0 min');

  const stale: PlayerMatchEntry = {
    matchId: 'm1', title: 'League', matchDate: '2026-09-27', opponentName: 'Northside',
    teamSeconds: 3600, playedSeconds: 600, listedAs: 'bench', recordedAt: '2026-09-27T11:00:00.000Z',
  };
  const fresh: PlayerMatchEntry = { ...stale, playedSeconds: 3000, recordedAt: '2026-09-28T09:00:00.000Z' };
  const mergedLog = mergeMatchLog([stale], [fresh, { ...fresh, matchId: 'm2', matchDate: '2026-10-04' }]);
  assert(
    'a fresher copy of a match wins the merge',
    mergedLog.find(entry => entry.matchId === 'm1')?.playedSeconds === 3000,
    mergedLog,
  );
  assert('merging keeps every distinct match', mergedLog.length === 2, mergedLog);
  const staleMerge = mergeMatchLog([fresh], [stale]);
  assert(
    'an older copy does not overwrite the newer one',
    staleMerge.find(entry => entry.matchId === 'm1')?.playedSeconds === 3000,
    staleMerge,
  );

  // --- 3. share codes ------------------------------------------------------------------

  const sequence = (length: number): Uint8Array => Uint8Array.from({ length }, (_, index) => index);
  assert('a code is eight symbols', generateShareCode(sequence).length === SHARE_CODE_LENGTH);
  assert('bytes map onto the alphabet in order', generateShareCode(sequence) === 'ABCDEFGH', generateShareCode(sequence));
  const filled = (value: number) => (length: number): Uint8Array => Uint8Array.from({ length }, () => value);
  assert(
    'the last alphabet symbol is reachable and wraps',
    generateShareCode(filled(31)) === '99999999' && generateShareCode(filled(32)) === 'AAAAAAAA',
  );
  const generated = new Set(Array.from({ length: 200 }, () => generateShareCode()));
  assert(
    'randomly generated codes keep the shape',
    generated.size > 195 && [...generated].every(code => SHARE_CODE_PATTERN.test(code)),
    generated.size,
  );
  assert('no ambiguous characters are issued', ![...generated].some(code => /[IO01]/.test(code)));

  assert('a lower-case dashed code normalises', normaliseShareCode(' abcd-2345 ') === 'ABCD2345');
  assert('a code with spaces normalises', normaliseShareCode('PLAY ER24') === 'PLAYER24');
  assert('a valid code is accepted', isShareCode('PLAYER24'));
  assert('a short code is refused', !isShareCode('PLAYER2'));
  assert('an ambiguous code is refused', !isShareCode('ABCDEFGI') && !isShareCode('ABCDEFG0'));

  assert(
    'the web link carries the code as a query parameter',
    shareProfileWebLink('player24') === 'https://fracturedorbit1980.github.io/Clubstride-Pro-Web/?player=PLAYER24',
    shareProfileWebLink('player24'),
  );
  assert(
    'the deep link uses the app scheme',
    shareProfileDeepLink('player24') === 'clubstride://player?code=PLAYER24',
    shareProfileDeepLink('player24'),
  );
  assert('the web link reads back', shareCodeFromUrl(shareProfileWebLink('PLAYER24')) === 'PLAYER24');
  assert('the deep link reads back', shareCodeFromUrl(shareProfileDeepLink('PLAYER24')) === 'PLAYER24');
  assert('a bare code with punctuation reads back', shareCodeFromUrl(' player-24 ') === 'PLAYER24');
  assert('a foreign link is not mistaken for a code', shareCodeFromUrl('https://example.com/') === null);
  assert('a malformed code in a link is refused', shareCodeFromUrl('https://example.com/?player=NO') === null);
  assert('a fragment does not confuse the query', shareCodeFromUrl('https://example.com/?player=PLAYER24#top') === 'PLAYER24');

  const message = shareProfileMessage('  Mateo Rossi ', 'player24');
  assert(
    'the share message carries the name, link and code',
    message.startsWith("Mateo Rossi's Clubstride player profile") &&
      message.includes(shareProfileWebLink('PLAYER24')) &&
      message.endsWith('Access code: PLAYER24'),
    message,
  );
  assert('a nameless share message still reads', shareProfileMessage('   ', 'PLAYER24').startsWith("Player's Clubstride"));

  // --- 4. the preview squad -------------------------------------------------------------

  const assessment = demoAssessment('preview-player-1');
  assert('every preview player has a complete assessment', isComplete(assessment.scores), assessment);
  assert(
    'preview scores stay on the scale',
    METRICS.every(metric => normaliseRating(assessment.scores[metric.key]) === assessment.scores[metric.key]),
    assessment.scores,
  );
  assert(
    'preview scores differ between players',
    JSON.stringify(demoAssessment('preview-player-1').scores) !== JSON.stringify(demoAssessment('preview-player-2').scores),
  );

  const demoLog = demoMatchLog('preview-player-1');
  const demoSummary = summariseMinutes(demoLog);
  assert(
    'the preview log covers the finished matches only',
    demoLog.length === 4 && demoSummary.playedSeconds === 210 * 60 && demoSummary.totalSeconds === 240 * 60,
    demoSummary,
  );
  assert('the preview percentage is a real one', demoSummary.percentage === 0.875, demoSummary);
  assert(
    'the preview code is valid and opens its player',
    isShareCode(DEMO_SHARE_CODE) && previewSharedPlayer('player24')?.id === DEMO_PLAYERS[0]?.id,
    DEMO_SHARE_CODE,
  );
  assert(
    'each preview player has their own code',
    new Set(DEMO_PLAYERS.map(entry => previewShareCode(entry.id))).size === DEMO_PLAYERS.length,
  );
  assert('an unknown preview code opens nothing', previewSharedPlayer('PLAYER99') === null);

  // --- 5. the radar and the queued assessment -------------------------------------------

  assert(
    'four axes point up, right, down and left',
    [0, 1, 2, 3].map(index => radarAngle(index, 4)).join(',') === '-90,0,90,180',
  );
  const centre = { x: 100, y: 100 };
  const compass = [0, 1, 2, 3].map(index => radarPoint(index, 4, 1, 100, centre));
  assert(
    'the outer ring lands on the four compass points',
    Math.round(compass[0]!.x) === 100 && Math.round(compass[0]!.y) === 0 &&
      Math.round(compass[1]!.x) === 200 && Math.round(compass[1]!.y) === 100 &&
      Math.round(compass[2]!.x) === 100 && Math.round(compass[2]!.y) === 200 &&
      Math.round(compass[3]!.x) === 0 && Math.round(compass[3]!.y) === 100,
    compass,
  );
  assert('a rating of 3 draws at 60 percent of the ring', ratingFraction(3) === 0.6);
  assert('a rating of 5 reaches the ring', ratingFraction(5) === 1);
  assert('nothing scored sits at the centre', ratingFraction(null) === 0);
  assert('an off-scale rating is clamped', ratingFraction(7) === 1 && ratingFraction(-2) === 0);
  const plotted = radarPoints([3, null, 5, 1], 100, centre);
  assert('an unscored axis plots at the centre', Math.round(plotted[1]!.x) === 100 && Math.round(plotted[1]!.y) === 100);
  assert('the polygon attribute rounds to one decimal', pointsAttribute([{ x: 1.04, y: 2.06 }]) === '1,2.1');

  const sample = {
    id: 'ignored',
    playerId: 'p1',
    scores: { passing_accuracy: 4, stamina: 3.5, made_up: 5 } as Scores,
    coachNotes: 'Keep scanning.',
    recordedAt: '2026-10-20T17:00:00.000Z',
  };
  const assessmentRow = toAssessmentRow(sample, 'team-1');
  assert('an assessment row is keyed by the player, not the session', assessmentRow.id === assessmentRowId('p1'));
  assert('the row id is the same on any phone', assessmentRowId('p1') === assessmentRowId('p1'));
  assert(
    'only scored metrics reach the row',
    JSON.stringify(assessmentRow.scores) === JSON.stringify({ passing_accuracy: 4, stamina: 3.5 }),
    assessmentRow.scores,
  );
  assert('the row carries its team', assessmentRow.team_id === 'team-1' && assessmentRow.player_id === 'p1');

  const readBack = parseAssessmentRow(assessmentRow);
  assert(
    'a stored row reads back with its scores and note',
    readBack !== null &&
      readBack.playerId === 'p1' &&
      readBack.coachNotes === 'Keep scanning.' &&
      readBack.scores.passing_accuracy === 4 &&
      readBack.scores.stamina === 3.5,
    readBack,
  );
  assert('a row with no player is dropped', parseAssessmentRow({ recorded_at: assessmentRow.recorded_at }) === null);
  assert('a row with no version is dropped', parseAssessmentRow({ player_id: 'p1' }) === null);
  assert('a row with an unreadable version is dropped', parseAssessmentRow({ player_id: 'p1', recorded_at: 'yesterday' }) === null);
  assert('a blank note reads as none', parseAssessmentRow({ ...assessmentRow, coach_notes: '   ' })?.coachNotes === null);

  const payload = assessmentPayload(sample, 'team-1');
  let payloadProblem: string | null = null;
  try {
    assertQueuedPayload('player_assessments', payload);
  } catch (error) {
    payloadProblem = String(error);
  }
  assert('an assessment payload satisfies the outbox contract', payloadProblem === null, payloadProblem);
  assert(
    'the payload carries the version and no server-owned column',
    payload.recorded_at === sample.recordedAt && payload.team_id === 'team-1' && !('id' in payload) && !('created_by' in payload),
    payload,
  );

  const earlier = { ...sample, id: 'a', recordedAt: '2026-10-01T09:00:00.000Z' };
  const later = { ...sample, id: 'b', recordedAt: '2026-10-20T09:00:00.000Z' };
  assert('the later assessment wins', pickNewerAssessment(earlier, later)?.id === 'b');
  assert('a stale server copy does not win', pickNewerAssessment(later, earlier)?.id === 'b');
  assert('the first assessment is kept when nothing arrives', pickNewerAssessment(later, null)?.id === 'b');

  const parsedMatches = parseMatchRows([
    matches[0],
    { ...matches[0], recorded_at: '2026-09-27T12:00:00.000Z', duration_seconds: 3000 },
    { id: 'bad', opponent_name: 'No date' },
    'nonsense',
  ]);
  assert('malformed match rows are counted, not guessed at', parsedMatches.rows.length === 1 && parsedMatches.dropped === 2, parsedMatches);
  assert(
    'a duplicated match keeps its newest version',
    parsedMatches.rows[0]?.duration_seconds === 3000,
    parsedMatches.rows[0],
  );
  const parsedLineup = parseLineupRows([
    { match_id: 'm1', player_id: 'p1', listed_as: 'starter', recorded_seconds: 600 },
    { match_id: 'm1', player_id: 'p1', listed_as: 'starter', recorded_seconds: 900 },
    { match_id: 'm1' },
  ]);
  assert(
    'one line-up row per match and player, last copy wins',
    parsedLineup.rows.length === 1 && parsedLineup.rows[0]?.recorded_seconds === 900 && parsedLineup.dropped === 1,
    parsedLineup,
  );

  // --- 6. the one-page player report PDF ------------------------------------------------
  //
  // The PDF is bytes, so these checks read the content stream as latin1 text: that is enough
  // to prove the page carries the player, the share code and a filled radar polygon without a
  // PDF library in the toolchain.
  const player = DEMO_PLAYERS[0];
  const demo = demoAssessment(player.id);
  const reportInput: PlayerReportInput = {
    teamName: 'Clubstride FC',
    playerName: player.full_name,
    shirtNumber: player.shirt_number,
    position: player.position_tag,
    scores: demo.scores,
    coachNotes: demo.coachNotes,
    minutes: summariseMinutes(demoMatchLog(player.id)),
    shareCode: DEMO_SHARE_CODE,
    generatedAt: new Date(2026, 9, 27, 9, 30),
  };

  const pdfText = (bytes: Uint8Array): string => {
    let out = '';
    for (const byte of bytes) out += String.fromCharCode(byte);
    return out;
  };

  const report = pdfText(buildPlayerReportPdf(reportInput));
  assert('the report is a PDF 1.4 file', report.startsWith('%PDF-1.4') && report.endsWith('%%EOF'));
  assert('the report is exactly one page', (report.match(/\/Count 1\b/g) ?? []).length === 1);
  assert(
    'the page names the player, club and report',
    report.includes('Player Report') &&
      report.includes(player.full_name) &&
      report.includes('Clubstride FC') &&
      report.includes('Page 1 of 1'),
    player.full_name,
  );
  assert(
    'the page carries game time and the rating sections',
    report.includes('GAME TIME') &&
      report.includes('MINUTES PLAYED') &&
      report.includes('MATCHES PLAYED') &&
      report.includes('Rating profile') &&
      report.includes('Coach note') &&
      report.includes('88%'),
  );
  assert(
    'the radar is drawn as a filled and stroked polygon',
    report.includes(' h f') && report.includes(' h S') && report.includes(' c f'),
  );
  assert(
    'the share code and web link travel with the report',
    report.includes(DEMO_SHARE_CODE) && report.includes(shareProfileWebLink(DEMO_SHARE_CODE)),
  );
  assert(
    'the report file name names the player and the day',
    playerReportFileName(player.full_name, new Date(2026, 9, 27)) ===
      'clubstride-player-mateo-rossi-2026-10-27.pdf',
    playerReportFileName(player.full_name, new Date(2026, 9, 27)),
  );
  assert(
    'the same input and clock produce the same bytes',
    pdfText(buildPlayerReportPdf(reportInput)) === report,
  );

  const longNote = 'x'.repeat(1900) + ' tail';
  const longReport = pdfText(buildPlayerReportPdf({ ...reportInput, coachNotes: longNote }));
  assert(
    'a long note is clipped to the page and says where the rest is',
    // Parentheses are escaped inside a PDF string, so look for the words, not the markup.
    longReport.includes('full note in the app') && !longReport.includes('x'.repeat(1900)),
  );
  assert(
    'an empty note and a missing code each read as absent, not blank',
    pdfText(buildPlayerReportPdf({ ...reportInput, coachNotes: null, shareCode: null })).includes(
      'No coach note yet.',
    ) &&
      pdfText(buildPlayerReportPdf({ ...reportInput, shareCode: null })).includes(
        'No share code has been issued for this player yet.',
      ),
  );
  const trickyReport = pdfText(
    buildPlayerReportPdf({ ...reportInput, playerName: 'Zoë (Test)', coachNotes: 'Marks: 4/5 (left)' }),
  );
  assert(
    'dashes and brackets do not break the text stream',
    trickyReport.includes('Zo\\353 \\(Test\\)') && trickyReport.includes('\\(left\\)'),
  );

  // --- 7. the shared profile returned by a code -----------------------------------------
  //
  // This payload reaches a visitor who is not signed in, so it is parsed, never trusted:
  // malformed match rows are dropped and counted, and minutes past the whistle are clamped.

  const shared = parseSharedProfile({
    player: {
      id: ' p1 ',
      full_name: '  Mateo Rossi ',
      shirt_number: 1,
      position_tag: 'Goalkeeper',
      team_name: 'Clubstride Test FC',
    },
    assessment: {
      scores: { passing_accuracy: 4.5, made_up: 5, stamina: '3' },
      coach_notes: '  Keep scanning.  ',
      recorded_at: '2026-10-20T17:00:00.000Z',
    },
    minutes: {
      matches: [
        {
          match_id: 'm1',
          match_date: '2026-09-27',
          duration_seconds: 3600,
          played_seconds: 2700,
          title: 'League',
          opponent_name: 'Northside',
          recorded_at: '2026-09-27T10:00:00.000Z',
        },
        { match_id: 'm2', match_date: '2026-10-04', duration_seconds: 3600, played_seconds: 9999, opponent_name: '' },
        { match_id: 'm3', match_date: '2026-13-40', duration_seconds: 3600, played_seconds: 600 },
        'nonsense',
        { match_date: '2026-10-11', duration_seconds: 3000, played_seconds: 600 },
      ],
    },
    generated_at: '2026-10-27T09:30:00.000Z',
  });
  const sharedProfile = shared.profile;
  assert('a code payload parses into one profile', sharedProfile !== null);
  assert(
    'the shared player keeps its identity and team',
    sharedProfile?.player.id === 'p1' &&
      sharedProfile.player.fullName === 'Mateo Rossi' &&
      sharedProfile.player.shirtNumber === 1 &&
      sharedProfile.player.position === 'Goalkeeper' &&
      sharedProfile.player.teamName === 'Clubstride Test FC',
    sharedProfile?.player,
  );
  assert(
    'shared scores are validated, not stored as sent',
    JSON.stringify(sharedProfile?.scores) === JSON.stringify({ passing_accuracy: 4.5 }),
    sharedProfile?.scores,
  );
  assert('the shared note is trimmed', sharedProfile?.coachNotes === 'Keep scanning.' && sharedProfile?.recordedAt === '2026-10-20T17:00:00.000Z');
  assert(
    'unreadable match rows are dropped and counted',
    shared.dropped === 3 && sharedProfile?.entries.length === 2,
    { dropped: shared.dropped, entries: sharedProfile?.entries },
  );
  assert(
    'shared match rows read newest first and clamp past the whistle',
    sharedProfile?.entries.map(entry => `${entry.matchId}:${entry.playedSeconds}`).join(',') === 'm2:3600,m1:2700',
    sharedProfile?.entries,
  );
  assert(
    'a row without a title still has a name',
    sharedProfile?.entries[0]?.title === 'Match' && sharedProfile.entries[0]?.opponentName === '',
    sharedProfile?.entries[0],
  );
  assert(
    'the shared game time is summed from those rows',
    sharedProfile?.summary.playedSeconds === 6300 &&
      sharedProfile.summary.totalSeconds === 7200 &&
      sharedProfile.summary.matches === 2 &&
      sharedProfile.summary.percentage === 6300 / 7200,
    sharedProfile?.summary,
  );
  assert('the shared page knows when it was generated', sharedProfile?.generatedAt === '2026-10-27T09:30:00.000Z');

  assert('an empty payload opens nothing', parseSharedProfile(null).profile === null);
  assert('a player without a shirt number opens nothing', parseSharedProfile({ player: { id: 'p', full_name: 'X' } }).profile === null);
  assert('a player without a name opens nothing', parseSharedProfile({ player: { id: 'p', shirt_number: 3 } }).profile === null);

  const bare = parseSharedProfile({
    player: { id: 'p2', full_name: 'Axel', shirt_number: 2 },
    assessment: null,
    minutes: { matches: [] },
    generated_at: 'yesterday',
  }).profile;
  assert(
    'a profile with no assessment and no matches still reads',
    bare?.scores && Object.keys(bare.scores).length === 0 && bare.coachNotes === null && bare.entries.length === 0,
    bare,
  );
  assert(
    'no matches means no shared percentage and a fallback team',
    bare?.summary.percentage === null && bare.player.teamName === 'Clubstride' && bare.player.position === null && bare.generatedAt === null,
    bare,
  );

  const crowded = parseSharedProfile({
    player: { id: 'p3', full_name: 'Leo', shirt_number: 8 },
    assessment: { scores: {}, coach_notes: 'y'.repeat(2500) },
  }).profile;
  assert('a shared note is capped at 2000 characters', crowded?.coachNotes?.length === 2000, crowded?.coachNotes?.length);

  console.log(process.exitCode ? '\nSOME PLAYER CHECKS FAILED' : '\nall player checks passed');
}

export const done = main();
