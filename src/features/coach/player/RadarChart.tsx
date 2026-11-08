import React from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { ci } from '../../shared/ci';
import { radarAngle, radarGeometry, radarPoint, pointsAttribute, type RadarPoint } from './radar';

const VIEW = 300;
const CENTER = { x: VIEW / 2, y: VIEW / 2 };
const RADIUS = 86;
const LABEL_GAP = 14;
const GRID = [0.2, 0.4, 0.6, 0.8, 1];
/** SVG text does not inherit the page font on web, and falls back to a serif without this. */
const LABEL_FONT = Platform.OS === 'web' ? "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" : null;

/**
 * Four axes, one per category average. The ring marks are the scale itself, so a player scored
 * 3s draws a diamond halfway out; the numbers in the list under it are what a parent reads, not
 * the shape alone. An axis with no rating stays open: it is drawn as a dashed spoke with no
 * point, because a shape pulled to the centre would look like the lowest score on the scale.
 * Drawn in a fixed viewBox and scaled down on a narrow phone: text stays proportional instead
 * of a label clipping at the card edge.
 */
export const RadarChart: React.FC<{
  values: readonly (number | null)[],
  labels: readonly string[];
}> = ({ values, labels }) => {
  const { width } = useWindowDimensions();
  // Screen padding (16 each side) plus the card's (14 each side).
  const widthOnScreen = Math.max(220, Math.min(VIEW, width - 60));
  const count = labels.length;
  const { points, unrated } = radarGeometry(values, RADIUS, CENTER);
  const rated = points.filter((point): point is RadarPoint => point !== null);
  const complete = count > 0 && unrated.length === 0;
  const hasScores = rated.length > 0;

  // Adjacent rated axes join up. A line across an unrated axis would rate it by implication.
  const segments: [RadarPoint, RadarPoint][] = [];
  if (!complete) {
    for (let index = 0; index < count; index += 1) {
      const from = points[index];
      const to = points[(index + 1) % count];
      if (from && to) segments.push([from, to]);
    }
  }

  const description = values
    .map((value, index) => `${labels[index]}: ${value === null ? 'not rated' : `average ${value}`}`)
    .join('. ');

  return (
    <Svg
      width={widthOnScreen}
      height={widthOnScreen}
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      accessibilityLabel={`Ratings radar. ${description}`}
    >
      {GRID.map(fraction => (
        <Polygon
          key={fraction}
          points={pointsAttribute(
            Array.from({ length: count }, (_, index) =>
              radarPoint(index, count, fraction, RADIUS, CENTER),
            ),
          )}
          fill="none"
          stroke={ci.color.border}
          strokeWidth={1}
        />
      ))}

      {labels.map((label, index) => {
        const edge = radarPoint(index, count, 1, RADIUS, CENTER);
        const open = unrated.includes(index);
        return (
          <Line
            key={`axis-${label}`}
            x1={CENTER.x}
            y1={CENTER.y}
            x2={edge.x}
            y2={edge.y}
            stroke={open ? ci.color.borderInput : ci.color.border}
            strokeWidth={1}
            {...(open ? { strokeDasharray: '4 4' } : {})}
          />
        );
      })}

      {complete ? (
        <Polygon
          points={pointsAttribute(rated)}
          fill={ci.color.primary}
          fillOpacity={hasScores ? 0.28 : 0}
          stroke={ci.color.primary}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      ) : null}

      {segments.map(([from, to], index) => (
        <Line
          key={`segment-${index}`}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={ci.color.primary}
          strokeWidth={2}
          strokeLinecap="round"
        />
      ))}

      {points.map((point, index) =>
        point ? <Circle key={`vertex-${index}`} cx={point.x} cy={point.y} r={3.5} fill={ci.color.accent} /> : null,
      )}

      {labels.map((label, index) => {
        const anchor = radarPoint(index, count, 1, RADIUS + LABEL_GAP, CENTER);
        const radians = (radarAngle(index, count) * Math.PI) / 180;
        const horizontal = Math.cos(radians);
        const textAnchor = Math.abs(horizontal) < 0.2 ? 'middle' : horizontal > 0 ? 'start' : 'end';
        return (
          <SvgText
            key={`label-${label}`}
            x={anchor.x}
            y={anchor.y}
            fill={ci.color.muted}
            fontSize={12}
            fontWeight="700"
            textAnchor={textAnchor}
            alignmentBaseline="middle"
            {...(LABEL_FONT ? { fontFamily: LABEL_FONT } : {})}
          >
            {label}
          </SvgText>
        );
      })}
    </Svg>
  );
};
