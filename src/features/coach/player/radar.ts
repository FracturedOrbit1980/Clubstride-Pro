import { RATING_MAX } from './assessment';

export interface RadarPoint {
  x: number;
  y: number;
}

/**
 * 0..1 of the outer ring, or null when the category carries no rating. A missing rating is not a
 * zero, so it must not be plotted at the centre - callers keep the axis open instead.
 */
export const ratingFraction = (rating: number | null): number | null => {
  if (rating === null || !Number.isFinite(rating)) return null;
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

export interface RadarGeometry {
  /** One entry per axis, in the order the categories are listed. Null means no rating yet. */
  points: (RadarPoint | null)[];
  /** Indices with no rating, so the renderer can leave those axes open. */
  unrated: number[];
}

/**
 * Plots the rated axes and reports the ones with no rating. An unrated category draws no point:
 * putting it at the centre would read as the lowest score on the scale.
 */
export const radarGeometry = (
  values: readonly (number | null)[],
  radius: number,
  center: RadarPoint,
): RadarGeometry => {
  const points = values.map((value, index) => {
    const fraction = ratingFraction(value);
    return fraction === null ? null : radarPoint(index, values.length, fraction, radius, center);
  });
  const unrated: number[] = [];
  points.forEach((point, index) => {
    if (point === null) unrated.push(index);
  });
  return { points, unrated };
};

/** The `points` attribute an SVG polygon wants: 'x,y x,y ...', rounded so the markup stays short. */
export const pointsAttribute = (points: readonly RadarPoint[]): string =>
  points.map(point => `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`).join(' ');
