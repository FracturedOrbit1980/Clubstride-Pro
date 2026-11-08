import type { SquadPlayerRow } from '../coach/attendance/squad';
import type { PlayerAssessment } from '../coach/player/assessment';
import { parseAssessmentRow } from '../coach/player/assessmentSync';

/**
 * What a club administrator is allowed to see about an adult: enough to recognise the account,
 * never the address itself. The full string is readable by this role in the database, so the mask
 * is data minimisation on a shared desktop, not access control - the backend decides access.
 */
export interface MaskedAccount {
  name: string;
  email: string;
}

export interface GuardianLink {
  id: string;
  playerId: string;
  userId: string;
  relationship: string | null;
  createdAt: string;
  /** Null when the account is not a member of this squad, so its row is outside the read policy. */
  account: MaskedAccount | null;
}

export interface ClubAdult {
  userId: string;
  role: 'manager' | 'coach' | 'parent';
  account: MaskedAccount;
}

export interface ParsedLinks {
  links: GuardianLink[];
  dropped: number;
}

export interface ParsedAdults {
  adults: ClubAdult[];
  dropped: number;
}

const ROLES = ['manager', 'coach', 'parent'] as const;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** First letter and domain only: `r••••@club.example`. Two families on one domain stay told apart
 * by the name beside it, and a whole address never reaches this screen. */
export function maskEmail(value: unknown): string {
  const email = text(value).toLowerCase();
  if (!email.includes('@')) return 'no address on file';
  const [local, domain] = email.split('@');
  if (!local || !domain) return 'no address on file';
  return `${local.slice(0, 1)}••••@${domain}`;
}

/** PostgREST returns a to-one embed as an object, and as an array when the join is ambiguous. */
const embeddedAccount = (value: unknown): MaskedAccount | null => {
  const row = Array.isArray(value) ? value[0] : value;
  if (typeof row !== 'object' || row === null) return null;
  const raw = row as Record<string, unknown>;
  const first = text(raw.first_name);
  const last = text(raw.last_name);
  const name = [first, last].filter(Boolean).join(' ');
  if (!name) return null;
  return { name, email: maskEmail(raw.email) };
};

const isRole = (value: unknown): value is ClubAdult['role'] =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

/** One row per guardianship the club already recorded, newest link first. */
export function parseGuardianLinks(value: unknown): ParsedLinks {
  if (!Array.isArray(value)) return { links: [], dropped: value === null || value === undefined ? 0 : 1 };
  const links: GuardianLink[] = [];
  let dropped = 0;
  for (const item of value) {
    if (typeof item !== 'object' || item === null) { dropped += 1; continue; }
    const raw = item as Record<string, unknown>;
    const id = text(raw.id);
    const playerId = text(raw.player_id);
    const userId = text(raw.user_id);
    if (!id || !playerId || !userId) { dropped += 1; continue; }
    links.push({
      id,
      playerId,
      userId,
      relationship: text(raw.relationship) || null,
      createdAt: text(raw.created_at),
      account: embeddedAccount(raw.users),
    });
  }
  links.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { links, dropped };
}

/** Everyone holding a seat on this squad: the manager, the coaches, and any family account. */
export function parseClubAdults(value: unknown): ParsedAdults {
  if (!Array.isArray(value)) return { adults: [], dropped: value === null || value === undefined ? 0 : 1 };
  const adults: ClubAdult[] = [];
  let dropped = 0;
  for (const item of value) {
    if (typeof item !== 'object' || item === null) { dropped += 1; continue; }
    const raw = item as Record<string, unknown>;
    const userId = text(raw.user_id);
    if (!userId || !isRole(raw.member_role)) { dropped += 1; continue; }
    const account = embeddedAccount(raw.users);
    if (!account) { dropped += 1; continue; }
    adults.push({ userId, role: raw.member_role, account });
  }
  const order: Record<ClubAdult['role'], number> = { manager: 0, coach: 1, parent: 2 };
  adults.sort((a, b) => order[a.role] - order[b.role] || a.account.name.localeCompare(b.account.name));
  return { adults, dropped };
}

export const roleLabel = (role: ClubAdult['role']): string =>
  role === 'manager' ? 'Club manager' : role === 'coach' ? 'Coach' : 'Family account';

/** Latest row per child, keyed by the stable player id. */
export function parseAssessmentRows(value: unknown): { byPlayer: Record<string, PlayerAssessment>; dropped: number } {
  const byPlayer: Record<string, PlayerAssessment> = {};
  if (!Array.isArray(value)) return { byPlayer, dropped: value === null || value === undefined ? 0 : 1 };
  let dropped = 0;
  for (const item of value) {
    const parsed = parseAssessmentRow(item);
    if (!parsed) { dropped += 1; continue; }
    const known = byPlayer[parsed.playerId];
    if (!known || known.recordedAt.localeCompare(parsed.recordedAt) <= 0) byPlayer[parsed.playerId] = parsed;
  }
  return { byPlayer, dropped };
}

export const linksForPlayer = (links: readonly GuardianLink[], playerId: string): GuardianLink[] =>
  links.filter(link => link.playerId === playerId);

/** Children no family account can reach - the list an administrator has to work through. */
export const playersWithoutLink = (players: readonly SquadPlayerRow[], links: readonly GuardianLink[]): SquadPlayerRow[] => {
  const linked = new Set(links.map(link => link.playerId));
  return players.filter(player => !linked.has(player.id));
};

export const coachesOn = (adults: readonly ClubAdult[]): ClubAdult[] =>
  adults.filter(adult => adult.role === 'coach');

/** The line that says what a manager cannot fix here, in the admin's own words. */
export const pendingText = (unlinked: number, coaches: number): string => {
  const parts: string[] = [];
  parts.push(unlinked === 0 ? 'every child has a family account linked' : `${unlinked} of the squad still has no family account linked`);
  parts.push(coaches === 0 ? 'no coach holds a seat yet' : `${coaches} coach${coaches === 1 ? ' holds' : 'es hold'} a seat`);
  return `Read together: ${parts.join(', and ')}.`;
};
