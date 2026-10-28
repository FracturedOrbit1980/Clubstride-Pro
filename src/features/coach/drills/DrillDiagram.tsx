import React, { useEffect, useRef, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { ci } from '../../shared/ci';
import {
  DRILL_AREA_BOUNDS,
  legMidpoint,
  markerState,
  routeLegs,
  routeTimings,
  type DrillArea,
  type DrillLeg,
  type DrillPlan,
  type DrillPoint,
  type DrillRoute,
  type DrillSide,
} from './drillPlan';

/**
 * The diagram: pitch furniture, the set-up drawn from the plan, and the movement replayed in
 * order. Positions are fractions of this fixed box, so one plan fills a 320 px phone or a tablet
 * and the labels scale with the drawing instead of clipping at the card edge.
 */
const VIEW_W = 320;
const VIEW_H = 240;
/** Smooth enough to read as movement, slow enough that a phone at arm's length keeps up. */
const TICK_MS = 70;

const SIDE_COLOR: Record<DrillSide, string> = {
  att: ci.color.primary,
  def: ci.color.danger,
  keeper: ci.color.warning,
};

const CONE = ci.color.accent;
const PITCH_LINE = ci.color.border;
const PITCH_FILL = ci.color.raised;
/** SVG text does not inherit the page font on web, and falls back to a serif without this. */
const LABEL_FONT =
  Platform.OS === 'web' ? "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" : null;

const X = (fraction: number): number => fraction * VIEW_W;
const Y = (fraction: number): number => fraction * VIEW_H;

const attributes = (points: readonly DrillPoint[]): string =>
  points.map(point => `${X(point.x).toFixed(1)},${Y(point.y).toFixed(1)}`).join(' ');

const curve = (points: readonly DrillPoint[]): string =>
  `M ${points.map(point => `${X(point.x).toFixed(1)} ${Y(point.y).toFixed(1)}`).join(' L ')}`;

/** An arc as a polyline: the bulge is where I put it, with no sweep flag to read wrong. */
const arc = (centre: DrillPoint, radius: number, fromDegrees: number, toDegrees: number): DrillPoint[] => {
  const points: DrillPoint[] = [];
  const steps = 14;
  for (let step = 0; step <= steps; step += 1) {
    const degrees = fromDegrees + ((toDegrees - fromDegrees) * step) / steps;
    const radians = (degrees * Math.PI) / 180;
    points.push({
      x: centre.x + (radius * Math.cos(radians)) / VIEW_W,
      y: centre.y + (radius * Math.sin(radians)) / VIEW_H,
    });
  }
  return points;
};

const ArcLine: React.FC<{ points: readonly DrillPoint[] }> = ({ points }) => (
  <Path d={curve(points)} fill="none" stroke={PITCH_LINE} strokeWidth={1.2} />
);

const box = (left: number, top: number, right: number, bottom: number) => ({
  x: X(left),
  y: Y(top),
  width: X(right - left),
  height: Y(bottom - top),
});

/** The outline of the area a drill happens inside, from the bounds a plan is checked against. */
const pitchRect = (area: DrillArea) => {
  const bounds = DRILL_AREA_BOUNDS[area];
  return box(bounds.left, bounds.top, bounds.right, bounds.bottom);
};

const routeColor = (route: DrillRoute): string => {
  if (route.kind === 'shot') return ci.color.go;
  if (route.kind === 'run' || route.kind === 'dribble') return ci.color.accent;
  return ci.color.primary;
};

/** Half a pitch: own goal line on the left, halfway line on the right, play runs left to right. */
const HalfFurniture: React.FC = () => (
  <>
    <Rect {...pitchRect('half')} fill={PITCH_FILL} stroke={PITCH_LINE} strokeWidth={1.5} />
    <Rect {...box(0.045, 0.22, 0.34, 0.78)} fill="none" stroke={PITCH_LINE} strokeWidth={1.2} />
    <Rect {...box(0.045, 0.36, 0.15, 0.64)} fill="none" stroke={PITCH_LINE} strokeWidth={1.2} />
    <Rect {...box(0.015, 0.44, 0.045, 0.56)} fill={PITCH_LINE} stroke={PITCH_LINE} strokeWidth={1} />
    <Circle cx={X(0.24)} cy={Y(0.5)} r={2.5} fill={PITCH_LINE} />
    <ArcLine points={arc({ x: 0.24, y: 0.5 }, 48, -48, 48)} />
    <ArcLine points={arc({ x: 0.955, y: 0.5 }, 40, 90, 270)} />
  </>
);

/** The attacking end blown up, enough of the box to show where the runners arrive. */
const BoxFurniture: React.FC = () => (
  <>
    <Rect {...pitchRect('box')} fill={PITCH_FILL} stroke={PITCH_LINE} strokeWidth={1.5} />
    <Rect {...box(0.04, 0.14, 0.62, 0.86)} fill="none" stroke={PITCH_LINE} strokeWidth={1.2} />
    <Rect {...box(0.04, 0.33, 0.26, 0.67)} fill="none" stroke={PITCH_LINE} strokeWidth={1.2} />
    <Rect {...box(0.012, 0.44, 0.04, 0.56)} fill={PITCH_LINE} stroke={PITCH_LINE} strokeWidth={1} />
    <Circle cx={X(0.36)} cy={Y(0.5)} r={2.5} fill={PITCH_LINE} />
    <ArcLine points={arc({ x: 0.36, y: 0.5 }, 62, -22, 22)} />
  </>
);

/** An area marked out with cones: the outline the drill happens inside. */
const GridFurniture: React.FC = () => (
  <Rect {...pitchRect('grid')} fill={PITCH_FILL} stroke={PITCH_LINE} strokeWidth={1.5} />
);

/** A long corridor, the shape every dribbling and wide drill uses. */
const ChannelFurniture: React.FC = () => {
  const bounds = DRILL_AREA_BOUNDS.channel;
  return (
    <>
      <Rect {...pitchRect('channel')} fill={PITCH_FILL} stroke={PITCH_LINE} strokeWidth={1.5} />
      <Line
        x1={X(bounds.left)}
        y1={Y(0.5)}
        x2={X(bounds.right)}
        y2={Y(0.5)}
        stroke={PITCH_LINE}
        strokeWidth={1}
        strokeDasharray="5 6"
      />
    </>
  );
};

/** Three points pointing the way the ball or the player travels, built in pixel space. */
const chevronPoints = (leg: DrillLeg): string => {
  const from = { x: X(leg.from.x), y: Y(leg.from.y) };
  const to = { x: X(leg.to.x), y: Y(leg.to.y) };
  const mid = legMidpoint(leg);
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const cx = X(mid.x);
  const cy = Y(mid.y);
  const nose = 5;
  const wing = 3.6;
  const corners = [
    { x: cx + ux * nose, y: cy + uy * nose },
    { x: cx - ux * nose + uy * wing, y: cy - uy * nose - ux * wing },
    { x: cx - ux * nose - uy * wing, y: cy - uy * nose + ux * wing },
  ];
  return corners.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
};

const RouteLines: React.FC<{ route: DrillRoute; activeLeg: number | null }> = ({ route, activeLeg }) => {
  const legs = routeLegs(route);
  const color = routeColor(route);
  const solid = route.kind === 'run' || route.kind === 'dribble' || route.kind === 'shot';
  return (
    <>
      {legs.map((leg, index) => (
        <Line
          key={`leg-${index}`}
          x1={X(leg.from.x)}
          y1={Y(leg.from.y)}
          x2={X(leg.to.x)}
          y2={Y(leg.to.y)}
          stroke={color}
          strokeWidth={route.kind === 'shot' ? 3 : 2.2}
          strokeOpacity={activeLeg !== null && activeLeg !== index ? 0.3 : 0.95}
          strokeLinecap="round"
          {...(solid ? {} : { strokeDasharray: '7 6' })}
        />
      ))}
      {legs.map((leg, index) => (
        <Polygon
          key={`head-${index}`}
          points={chevronPoints(leg)}
          fill={color}
          fillOpacity={activeLeg !== null && activeLeg !== index ? 0.25 : 0.85}
        />
      ))}
    </>
  );
};

const Cone: React.FC<{ at: DrillPoint }> = ({ at }) => (
  <Polygon
    points={attributes([
      { x: at.x, y: at.y - 5 / VIEW_H },
      { x: at.x - 4.5 / VIEW_W, y: at.y + 4 / VIEW_H },
      { x: at.x + 4.5 / VIEW_W, y: at.y + 4 / VIEW_H },
    ])}
    fill={CONE}
  />
);

const Ball: React.FC<{ at: DrillPoint; moving?: boolean }> = ({ at, moving }) => (
  <>
    {moving ? <Circle cx={X(at.x)} cy={Y(at.y)} r={11} fill={ci.color.text} fillOpacity={0.14} /> : null}
    <Circle
      cx={X(at.x)}
      cy={Y(at.y)}
      r={moving ? 6.5 : 5}
      fill={ci.color.text}
      stroke={ci.color.onPrimary}
      strokeWidth={1.2}
    />
  </>
);

export const DrillDiagram: React.FC<{ plan: DrillPlan }> = ({ plan }) => {
  const { width } = useWindowDimensions();
  // Screen padding plus card padding, so a wide plan never pushes the page sideways.
  const drawWidth = Math.max(220, Math.min(VIEW_W, width - 60));
  const drawHeight = (drawWidth * VIEW_H) / VIEW_W;
  const startedAt = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  // Interval state rather than an animation library: the drill timer already drives the clock this
  // way, and a diagram that stops ticking must never take the screen down with it.
  useEffect(() => {
    const cycle = routeTimings(plan.routes);
    if (plan.routes.length === 0 || cycle.seconds <= 0) return;
    startedAt.current = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), TICK_MS);
    return () => clearInterval(id);
  }, [plan]);

  const states = plan.routes.map((_, index) => markerState(plan.routes, index, elapsed));

  return (
    <Svg
      width={drawWidth}
      height={drawHeight}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      accessibilityLabel="Drill diagram"
    >
      {plan.area === 'half' ? <HalfFurniture /> : null}
      {plan.area === 'box' ? <BoxFurniture /> : null}
      {plan.area === 'channel' ? <ChannelFurniture /> : null}
      {plan.area === 'grid' ? <GridFurniture /> : null}

      {plan.routes.map((route, index) => {
        const state = states[index];
        return (
          <RouteLines
            key={`route-${index}`}
            route={route}
            activeLeg={state && state.point !== null && !state.held ? state.leg : null}
          />
        );
      })}

      {plan.marks.map((mark, index) => {
        const at = mark.at;
        if (mark.kind === 'cone') return <Cone key={`mark-${index}`} at={at} />;
        if (mark.kind === 'ball') return <Ball key={`mark-${index}`} at={at} />;
        if (mark.kind === 'goal') {
          return (
            <Rect
              key={`mark-${index}`}
              {...box(at.x - 0.03, at.y - 0.06, at.x + 0.03, at.y + 0.06)}
              fill="none"
              stroke={PITCH_LINE}
              strokeWidth={1.4}
            />
          );
        }
        const fill = SIDE_COLOR[mark.side ?? 'att'];
        return (
          <React.Fragment key={`mark-${index}`}>
            <Circle cx={X(at.x)} cy={Y(at.y)} r={9} fill={fill} stroke={ci.color.onPrimary} strokeWidth={1.2} />
            {mark.label ? (
              <SvgText
                x={X(at.x)}
                y={Y(at.y)}
                fill={ci.color.onPrimary}
                fontSize={9}
                fontWeight="800"
                textAnchor="middle"
                alignmentBaseline="middle"
                {...(LABEL_FONT ? { fontFamily: LABEL_FONT } : {})}
              >
                {mark.label}
              </SvgText>
            ) : null}
          </React.Fragment>
        );
      })}

      {plan.routes.map((route, index) => {
        const state = states[index];
        if (!state?.point) return null;
        if (route.kind === 'run') {
          return (
            <Circle
              key={`marker-${index}`}
              cx={X(state.point.x)}
              cy={Y(state.point.y)}
              r={7}
              fill={ci.color.accent}
              stroke={ci.color.onPrimary}
              strokeWidth={1.2}
              opacity={state.held ? 0.5 : 1}
            />
          );
        }
        return <Ball key={`marker-${index}`} at={state.point} moving={!state.held} />;
      })}
    </Svg>
  );
};
