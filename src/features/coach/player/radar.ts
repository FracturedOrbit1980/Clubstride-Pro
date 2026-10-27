import { RATING_MAX } from './assessment';

export interface RadarPoint {
  x: number;
  y: number;
}

/** 0..1 of the outer ring. A rating of 5 is the ring; nothing scored sits at the centre. */
export const ratingFraction = (rating: number | null): number => {
  if (rating === null || !Number.isFinite(rating)) return 0;
  return Math.min(1, Math.max(0, rating / RATING_MAX));
};

/** Axis 0 points up and the rest run clockwise, so four categories read top, right, bottom, left. */
export const radarAngle = (index: number, count: number): number =>
  count > 0 ? -90 + (360 / count) * index : -90;

export const radarPoint = (
  index: number,
  count: number,
  fraction: number,
  radius: number,
  center: RadarPoint,
): RadarPoint => {
  const radians = (radarAngle(index, count) * Math.PI) / 180;
  const distance = Math.min(1, Math.max(0, fraction)) * radius;
  return { x: center.x + Math.cos(radians) * distance, y: center.y + Math.sin(radians) * distance };
};

/** One point per value, in the order the categories are listed. */
export const radarPoints = (
  values: readonly (number | null)[],
  radius: number,
  center: RadarPoint,
): RadarPoint[] =>
  values.map((value, index) => radarPoint(index, values.length, ratingFraction(value), radius, center));

/** The `points` attribute an SVG polygon wants: 'x,y x,y ...', rounded so the markup stays short. */
export const pointsAttribute = (points: readonly RadarPoint[]): string =>
  points.map(point => `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`).join(' ');
