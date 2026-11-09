/**
 * The staff-only note about one child, kept apart from the note a family reads.
 *
 * `player_assessments.coach_notes` goes to parents: the guardian clause in that table's read
 * policy, the shared-profile function and the report PDF all carry it. `player_private_notes`
 * belongs to nobody but the squad's coaches and managers, and it is not queued or cached - a
 * note that stays on the club server is the point, so an offline phone simply cannot write one.
 */

/** The database caps a note at 2000 characters; the editor and this clamp agree with it. */
export const PRIVATE_NOTE_MAX = 2000;

export interface PrivateNote {
  playerId: string;
  /** An empty string means nothing has been written. It is not "cleared since", and says so. */
  note: string;
  updatedAt: string | null;
}

/** Trim, then refuse more than the CHECK constraint will accept. */
export const clampPrivateNote = (text: string): string => {
  const trimmed = text.trim();
  return trimmed.length > PRIVATE_NOTE_MAX ? trimmed.slice(0, PRIVATE_NOTE_MAX) : trimmed;
};

export const parsePrivateNoteRow = (value: unknown): PrivateNote | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const playerId = typeof raw.player_id === 'string' ? raw.player_id : '';
  if (!playerId) return null;
  const text = typeof raw.note === 'string' ? clampPrivateNote(raw.note) : '';
  const stamp = typeof raw.updated_at === 'string' && !Number.isNaN(Date.parse(raw.updated_at))
    ? raw.updated_at
    : null;
  return { playerId, note: text, updatedAt: stamp };
};

/** `updated_by`, `created_at` and `updated_at` are stamped by the database, never sent. */
export const privateNotePayload = (
  playerId: string,
  teamId: string,
  note: string,
): Record<string, unknown> => ({
  player_id: playerId,
  team_id: teamId,
  note: clampPrivateNote(note),
});

/**
 * "No table yet" and "no signal" need different sentences: one is a migration Robert has to
 * apply, the other is a coach standing in a car park. PostgREST answers an unknown relation with
 * PGRST205 and the words "Could not find", raw SQL with 42P01 and "does not exist"; both name the
 * table. An access denial and a dead connection must not be read as a missing migration.
 */
export const isMissingPrivateNotesTable = (error: { code?: string; message?: string }): boolean => {
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  const message = error.message ?? '';
  return /player_private_notes/.test(message) && /(does not exist|not found|could not find)/i.test(message);
};
