/** Only what attendance needs, read from the same server row shape that gets cached. */
export interface SquadPlayerRow {
  id: string;
  full_name: string;
  shirt_number: number;
  position_tag: string | null;
  available: boolean;
}

export interface ParsedSquad {
  players: SquadPlayerRow[];
  dropped: number;
}

const toPlayer = (value: unknown): SquadPlayerRow | null => {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.full_name !== 'string') return null;
  if (typeof raw.shirt_number !== 'number' || !Number.isFinite(raw.shirt_number)) return null;
  if (raw.position_tag !== null && typeof raw.position_tag !== 'string') return null;
  if (typeof raw.available !== 'boolean') return null;
  return {
    id: raw.id,
    full_name: raw.full_name,
    shirt_number: raw.shirt_number,
    position_tag: raw.position_tag,
    available: raw.available,
  };
};

/** Sorted by shirt number, matching the squad screen. Unreadable rows are reported. */
export function parseSquadRows(value: unknown): ParsedSquad {
  if (value === null || value === undefined) return { players: [], dropped: 0 };
  if (!Array.isArray(value)) return { players: [], dropped: 1 };
  const players: SquadPlayerRow[] = [];
  let dropped = 0;
  for (const item of value) {
    const player = toPlayer(item);
    if (player) players.push(player);
    else dropped += 1;
  }
  players.sort((a, b) => a.shirt_number - b.shirt_number);
  return { players, dropped };
}
