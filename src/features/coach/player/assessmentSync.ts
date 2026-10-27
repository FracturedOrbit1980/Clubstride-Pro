import { stableRowId } from '../../../core/sync/stableId';
import type { SyncQueue } from '../../../core/sync/syncQueue';
import { parseScores, serialiseScores, type PlayerAssessment } from './assessment';

/** The snake_case shape shared by the server row, the cache and the outbox payload. */
export interface AssessmentRow {
  id: string;
  team_id: string;
  player_id: string;
  scores: Record<string, number>;
  coach_notes: string | null;
  recorded_at: string;
}

/**
 * One row per player, not one per session: the profile shows the current picture, and a fixed id
 * means two coaches rating the same child converge on one row instead of creating a second.
 */
export const assessmentRowId = (playerId: string): string => stableRowId('assessment', playerId);

export const toAssessmentRow = (assessment: PlayerAssessment, teamId: string): AssessmentRow => ({
  id: assessmentRowId(assessment.playerId),
  team_id: teamId,
  player_id: assessment.playerId,
  scores: serialiseScores(assessment.scores),
  coach_notes: assessment.coachNotes,
  recorded_at: assessment.recordedAt,
});

export const parseAssessmentRow = (value: unknown): PlayerAssessment | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const playerId = typeof raw.player_id === 'string' ? raw.player_id : '';
  const recordedAt = typeof raw.recorded_at === 'string' ? raw.recorded_at : '';
  if (!playerId || !recordedAt || Number.isNaN(Date.parse(recordedAt))) return null;
  const notes = typeof raw.coach_notes === 'string' ? raw.coach_notes.trim() : '';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : assessmentRowId(playerId),
    playerId,
    scores: parseScores(raw.scores),
    coachNotes: notes || null,
    recordedAt,
  };
};

export const assessmentPayload = (
  assessment: PlayerAssessment,
  teamId: string,
): Record<string, unknown> => ({
  team_id: teamId,
  player_id: assessment.playerId,
  scores: serialiseScores(assessment.scores),
  coach_notes: assessment.coachNotes,
  recorded_at: assessment.recordedAt,
});

/** False only while no session is attached, which the screen has to show rather than swallow. */
export const queueAssessment = (
  queue: SyncQueue,
  teamId: string,
  assessment: PlayerAssessment,
): boolean =>
  queue.enqueue({
    table: 'player_assessments',
    rowId: assessmentRowId(assessment.playerId),
    op: 'upsert',
    requiresRowId: null,
    recordedAt: assessment.recordedAt,
    payload: assessmentPayload(assessment, teamId),
  });

/** The later of two readings of the same player; null means nothing was rated yet. */
export const pickNewerAssessment = (
  current: PlayerAssessment | null,
  incoming: PlayerAssessment | null,
): PlayerAssessment | null => {
  if (!incoming) return current;
  if (!current) return incoming;
  return Date.parse(incoming.recordedAt) >= Date.parse(current.recordedAt) ? incoming : current;
};
