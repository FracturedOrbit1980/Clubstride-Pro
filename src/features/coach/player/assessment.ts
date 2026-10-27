/**
 * The 17 things a coach rates a young player on, in four groups. Half steps rather than whole
 * numbers: youth development moves slowly, and a five-point scale alone cannot show a player
 * who has nudged up over a term. Keys are stable because they are the JSONB keys stored on
 * player_assessments - renaming one orphans every recorded score.
 */

export type CategoryKey = 'technical' | 'physical' | 'tactical' | 'mental';

export type MetricKey =
  | 'passing_accuracy'
  | 'dribbling_control'
  | 'first_touch'
  | 'shooting_finishing'
  | 'weak_foot'
  | 'pace_speed'
  | 'agility'
  | 'stamina'
  | 'strength'
  | 'positioning'
  | 'scanning'
  | 'decision_making'
  | 'spatial_awareness'
  | 'work_rate'
  | 'resilience'
  | 'communication'
  | 'coachability';

export interface Metric {
  key: MetricKey;
  label: string;
  category: CategoryKey;
}

export const CATEGORIES: readonly { key: CategoryKey; label: string }[] = [
  { key: 'technical', label: 'Technical' },
  { key: 'physical', label: 'Physical' },
  { key: 'tactical', label: 'Tactical' },
  { key: 'mental', label: 'Mental' },
];

export const METRICS: readonly Metric[] = [
  { key: 'passing_accuracy', label: 'Passing accuracy', category: 'technical' },
  { key: 'dribbling_control', label: 'Dribbling / ball control', category: 'technical' },
  { key: 'first_touch', label: 'First touch', category: 'technical' },
  { key: 'shooting_finishing', label: 'Shooting / finishing', category: 'technical' },
  { key: 'weak_foot', label: 'Weak foot', category: 'technical' },
  { key: 'pace_speed', label: 'Pace / sprint speed', category: 'physical' },
  { key: 'agility', label: 'Agility / change of direction', category: 'physical' },
  { key: 'stamina', label: 'Stamina / endurance', category: 'physical' },
  { key: 'strength', label: 'Strength / core stability', category: 'physical' },
  { key: 'positioning', label: 'Positioning', category: 'tactical' },
  { key: 'scanning', label: 'Scanning', category: 'tactical' },
  { key: 'decision_making', label: 'Decision making', category: 'tactical' },
  { key: 'spatial_awareness', label: 'Spatial awareness', category: 'tactical' },
  { key: 'work_rate', label: 'Work rate', category: 'mental' },
  { key: 'resilience', label: 'Resilience', category: 'mental' },
  { key: 'communication', label: 'Communication / leadership', category: 'mental' },
  { key: 'coachability', label: 'Coachability', category: 'mental' },
];

export const METRICS_BY_CATEGORY: readonly { key: CategoryKey; label: string; metrics: readonly Metric[] }[] =
  CATEGORIES.map(category => ({
    key: category.key,
    label: category.label,
    metrics: METRICS.filter(metric => metric.category === category.key),
  }));

export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const RATING_STEP = 0.5;

/** 1, 1.5, ... 5 - the tap targets the editor renders, in order. */
export const RATING_OPTIONS: readonly number[] = Array.from(
  { length: Math.round((RATING_MAX - RATING_MIN) / RATING_STEP) + 1 },
  (_, index) => RATING_MIN + index * RATING_STEP,
);

export type Scores = Partial<Record<MetricKey, number>>;

export interface PlayerAssessment {
  id: string;
  playerId: string;
  scores: Scores;
  coachNotes: string | null;
  recordedAt: string;
}

const METRIC_KEYS: ReadonlySet<string> = new Set(METRICS.map(metric => metric.key));

/**
 * A score the app will store, or null. Anything off the half-step grid is rounded rather than
 * rejected: a slider or a future import can land on 3.24, and refusing to save it would leave
 * the coach with a form that will not close.
 */
export const normaliseRating = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < RATING_MIN || value > RATING_MAX) return null;
  return Math.round(value * 2) / 2;
};

export const setScore = (scores: Scores, key: MetricKey, value: unknown): Scores => {
  const rating = normaliseRating(value);
  const next: Scores = { ...scores };
  if (rating === null) delete next[key];
  else next[key] = rating;
  return next;
};

/** Reads a JSONB column back into scores, dropping unknown keys and values off the scale. */
export const parseScores = (value: unknown): Scores => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const scores: Scores = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!METRIC_KEYS.has(key)) continue;
    const rating = normaliseRating(raw);
    if (rating !== null) scores[key as MetricKey] = rating;
  }
  return scores;
};

/** Only the keys that have a score, so a cleared metric leaves no stale value in the row. */
export const serialiseScores = (scores: Scores): Record<string, number> => {
  const payload: Record<string, number> = {};
  for (const metric of METRICS) {
    const rating = scores[metric.key];
    if (rating !== undefined) payload[metric.key] = rating;
  }
  return payload;
};

export const scoredCount = (scores: Scores): number =>
  METRICS.reduce((count, metric) => (scores[metric.key] === undefined ? count : count + 1), 0);

export const isComplete = (scores: Scores): boolean => scoredCount(scores) === METRICS.length;

export const categoryAverage = (scores: Scores, category: CategoryKey): number | null => {
  const values = METRICS.filter(metric => metric.category === category)
    .map(metric => scores[metric.key])
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
};

export const categoryAverages = (scores: Scores): Record<CategoryKey, number | null> => ({
  technical: categoryAverage(scores, 'technical'),
  physical: categoryAverage(scores, 'physical'),
  tactical: categoryAverage(scores, 'tactical'),
  mental: categoryAverage(scores, 'mental'),
});

export const overallAverage = (scores: Scores): number | null => {
  const values = METRICS.map(metric => scores[metric.key]).filter(
    (value): value is number => value !== undefined,
  );
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
};

/** One decimal place: '4', '3.5', '2.4'. A whole number keeps its '.0' so columns line up. */
export const ratingText = (value: number | null): string => (value === null ? '-' : value.toFixed(1));
