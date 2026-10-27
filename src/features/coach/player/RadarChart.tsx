import React from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Polygon, Text as SvgText } from 'react-native-svg';
import { ci } from '../../shared/ci';
import { radarAngle, radarPoint, radarPoints, pointsAttribute } from './radar';

const VIEW = 300;
const CENTER = { x: VIEW / 2, y: VIEW / 2 };
const RADIUS = 86;
const LABEL_GAP = 14;
const GRID = [0.2, 0.4, 0.6, 0.8, 1];
/** SVG text does not inherit the page font on web, and falls back to a serif without this. */
const LABEL_FONT = Platform.OS === 'web' ? "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" : null;

/**
 * Four axes, one per category average. The ring marks are the scale itself, so a player scored
 * 3s draws a diamond halfway out; the numbers next to each vertex are what a parent reads, not
 * the shape alone. Drawn in a fixed viewBox and scaled down on a narrow phone: text stays
 * proportional instead of a label clipping at the card edge.
 */
export const RadarChart: React.FC<{
  values: readonly (number | null)[];
  labels: readonly string[];
}> = ({ values, labels }) => {
  const { width } = useWindowDimensions();
  // Screen padding (16 each side) plus the card's (14 each side).
  const widthOnScreen = Math.max(220, Math.min(VIEW, width - 60));
  const count = labels.length;
  const vertex = radarPoints(values, RADIUS, CENTER);
  const hasScores = values.some(value => value !== null);

  return (
    <Svg width={widthOnScreen} height={widthOnScreen} viewBox={`0 0 ${VIEW} ${VIEW}`} accessibilityLabel="Player ratings radar">
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
        return (
          <Line
            key={`axis-${label}`}
            x1={CENTER.x}
            y1={CENTER.y}
            x2={edge.x}
            y2={edge.y}
            stroke={ci.color.border}
            strokeWidth={1}
          />
        );
      })}

      <Polygon
        points={pointsAttribute(vertex)}
        fill={ci.color.primary}
        fillOpacity={hasScores ? 0.28 : 0}
        stroke={ci.color.primary}
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {vertex.map((point, index) => (
        <Circle key={`vertex-${index}`} cx={point.x} cy={point.y} r={3.5} fill={ci.color.accent} />
      ))}

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
