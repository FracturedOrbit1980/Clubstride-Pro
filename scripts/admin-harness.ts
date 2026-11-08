// Pure checks for the club administrator's page: the mask, the parsers, and what the demo club's
// own records look like through them. Run with the other harnesses:
//   node scripts/run-harness.mjs
import { DEMO_ADULTS, DEMO_LINKS, DEMO_PLAYERS, demoAssessment } from '../src/features/shared/demo';
import {
  coachesOn, linksForPlayer, maskEmail, parseAssessmentRows, parseClubAdults, parseGuardianLinks,
  pendingText, playersWithoutLink, roleLabel,
} from '../src/features/admin/clubRecords';

async function main(): Promise<void> {
  const assert = (label: string, condition: boolean, extra?: unknown): void => {
    if (condition) {
      console.log(`ok   ${label}`);
    } else {
      console.error(`FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra));
      process.exitCode = 1;
    }
  };

  // --- the address mask ---------------------------------------------------------------------------
  const masked = maskEmail('Elena.Rossi@Clubstride.Example');
  assert('an address keeps only its first letter and its domain', masked === 'e••••@clubstride.example', masked);
  assert('no part of the name survives the mask', !masked.toLowerCase().includes('lena') && !masked.toLowerCase().includes('rossi'), masked);
  assert('a missing address says so instead of printing nothing', maskEmail(null) === 'no address on file', maskEmail(null));
  assert('an address with no local part is not pretended', maskEmail('@clubstride.example') === 'no address on file', maskEmail('@clubstride.example'));
  assert('a one-letter address still masks', maskEmail('a@x.dev') === 'a••••@x.dev', maskEmail('a@x.dev'));

  // --- seats ---------------------------------------------------------------------------------------
  const seats = parseClubAdults([
    { user_id: 'u-3', member_role: 'parent', users: { first_name: 'Naledi', last_name: 'Mokoena', email: 'n@club.example' } },
    { user_id: 'u-2', member_role: 'coach', users: [{ first_name: 'Zanele', last_name: 'Dlamini', email: 'z@club.example' }] },
    { user_id: 'u-1', member_role: 'manager', users: { first_name: 'Rhian', last_name: 'Naidoo', email: 'r@club.example' } },
    { user_id: 'u-4', member_role: 'volunteer', users: { first_name: 'Nobody', last_name: 'Here', email: 'n@club.example' } },
    { user_id: '', member_role: 'coach', users: { first_name: 'No', last_name: 'Id' } },
  ]);
  assert('a seat list holds the rows that make sense', seats.adults.length === 3, seats.adults.length);
  assert('unreadable seats are counted, not swallowed', seats.dropped === 2, seats.dropped);
  assert('the manager is first, then coaches by name', seats.adults.map(adult => adult.role).join(',') === 'manager,coach,parent', seats.adults.map(adult => adult.role));
  assert('a seat prints a name, never a whole address', seats.adults.every(adult => adult.account.email.includes('••••')), seats.adults.map(adult => adult.account.email));
  assert('a role nobody in this app holds is refused', !seats.adults.some(adult => adult.userId === 'u-4'));
  assert('a coach seat is called a coach', roleLabel('coach') === 'Coach' && roleLabel('manager') === 'Club manager' && roleLabel('parent') === 'Family account');

  // --- links ---------------------------------------------------------------------------------------
  const parsedLinks = parseGuardianLinks([
    { id: 'l-1', player_id: 'p-1', user_id: 'u-1', relationship: 'Mother', created_at: '2026-10-02T10:00:00.000Z', users: null },
    { id: 'l-2', player_id: 'p-1', user_id: 'u-2', relationship: '', created_at: '2026-10-20T10:00:00.000Z', users: { first_name: 'Jonas', last_name: 'Lindqvist', email: 'j@club.example' } },
    { id: '', player_id: 'p-2', user_id: 'u-3', created_at: '2026-10-19T10:00:00.000Z' },
    'not a row',
  ]);
  assert('a link whose account is outside the squad is kept', parsedLinks.links.length === 2, parsedLinks.links.length);
  assert('rows that are not links are counted', parsedLinks.dropped === 2, parsedLinks.dropped);
  assert('the newest link is listed first', parsedLinks.links[0]?.id === 'l-2', parsedLinks.links[0]?.id);
  assert('an unseen account is named as such', parsedLinks.links[1]?.account === null, parsedLinks.links[1]?.account);
  assert('an empty relationship stays empty rather than invented', parsedLinks.links[0]?.relationship === null, parsedLinks.links[0]?.relationship);
  assert('links can be read for one child only', linksForPlayer(parsedLinks.links, 'p-1').length === 2 && linksForPlayer(parsedLinks.links, 'p-9').length === 0);
  assert('no link row reaches the page with a full address', parsedLinks.links.every(link => link.account === null || link.account.email.includes('••••')));

  // --- ratings -------------------------------------------------------------------------------------
  const row = (playerId: string, at: string, first: number) => ({
    id: `a-${playerId}-${at}`,
    player_id: playerId,
    scores: { passing_accuracy: first },
    coach_notes: null,
    recorded_at: at,
  });
  const ratings = parseAssessmentRows([
    row('p-1', '2026-09-01T00:00:00.000Z', 2),
    row('p-1', '2026-10-01T00:00:00.000Z', 4),
    row('p-2', '2026-10-01T00:00:00.000Z', 3),
    { id: 'broken' },
  ]);
  assert('one rating sheet per child survives', Object.keys(ratings.byPlayer).length === 2, Object.keys(ratings.byPlayer));
  assert('the newest sheet wins for a child', ratings.byPlayer['p-1']?.scores.passing_accuracy === 4, ratings.byPlayer['p-1']?.scores);
  assert('an unreadable rating row is counted', ratings.dropped === 1, ratings.dropped);
  assert('a row that is not an object leaves nothing behind', parseAssessmentRows(null).dropped === 0 && Object.keys(parseAssessmentRows(null).byPlayer).length === 0);

  // --- the demo club's own records -------------------------------------------------------------------
  const unlinked = playersWithoutLink(DEMO_PLAYERS, DEMO_LINKS);
  assert('the sample squad has more children than linked families', unlinked.length === 4, unlinked.map(player => player.full_name));
  assert('the children left out are the ones no link names', unlinked.map(player => player.id).join(',') === 'preview-player-4,preview-player-6,preview-player-8,preview-player-9', unlinked.map(player => player.id));
  assert('every sample link points at a real sample child', DEMO_LINKS.every(link => DEMO_PLAYERS.some(player => player.id === link.playerId)));
  assert('a sample link with no visible account is kept on purpose', DEMO_LINKS.some(link => link.account === null));
  assert('no sample adult or family carries a whole address', [...DEMO_ADULTS.map(adult => adult.account.email), ...DEMO_LINKS.flatMap(link => link.account ? [link.account.email] : [])].every(email => email.includes('••••')));
  assert('the sample club has two coaches', coachesOn(DEMO_ADULTS).length === 2, coachesOn(DEMO_ADULTS).map(adult => adult.account.name));
  assert('a sample child has a rating sheet to read', demoAssessment('preview-player-1').id === 'preview-assessment-preview-player-1');

  // --- the summary line ------------------------------------------------------------------------------
  assert('the open list is counted in the summary', pendingText(4, 2) === 'Read together: 4 of the squad still has no family account linked, and 2 coaches hold a seat.', pendingText(4, 2));
  assert('a finished list says it is finished', pendingText(0, 1).includes('every child has a family account linked'), pendingText(0, 1));
  assert('no coach seat is stated plainly', pendingText(0, 0).includes('no coach holds a seat yet'), pendingText(0, 0));
  assert('one coach is not written as many', pendingText(1, 1).includes('1 coach holds a seat'), pendingText(1, 1));
}

export const done = main();
