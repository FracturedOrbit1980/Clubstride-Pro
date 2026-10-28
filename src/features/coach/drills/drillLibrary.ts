/**
 * The ten drills every coach runs, bundled with the app rather than loaded from the club: they are
 * offline on the first visit, need no rows in any database, and are the same everywhere. Each one
 * carries a plan, so tapping it shows a diagram, plays the movement and tells a coach what to
 * watch for.
 *
 * A coach who wants one of these as a squad drill copies it into their list, and from that moment
 * it syncs and edits like anything else the squad owns.
 */
import type { Drill } from './drills';
import type { DrillPlan } from './drillPlan';

const PLANS: Record<string, DrillPlan> = {
  rondo: {
    area: 'grid',
    setup:
      'A 10 x 10 grid. Keep the ball under pressure, so the whole squad is passing, pressing and thinking at once.',
    marks: [
      { at: { x: 0.1, y: 0.14 }, kind: 'cone' },
      { at: { x: 0.9, y: 0.14 }, kind: 'cone' },
      { at: { x: 0.1, y: 0.86 }, kind: 'cone' },
      { at: { x: 0.9, y: 0.86 }, kind: 'cone' },
      { at: { x: 0.5, y: 0.2 }, kind: 'player', label: 'A', side: 'att' },
      { at: { x: 0.82, y: 0.5 }, kind: 'player', label: 'B', side: 'att' },
      { at: { x: 0.5, y: 0.8 }, kind: 'player', label: 'C', side: 'att' },
      { at: { x: 0.18, y: 0.5 }, kind: 'player', label: 'D', side: 'att' },
      { at: { x: 0.42, y: 0.46 }, kind: 'player', label: 'X', side: 'def' },
      { at: { x: 0.58, y: 0.6 }, kind: 'player', label: 'Y', side: 'def' },
    ],
    routes: [
      {
        kind: 'pass',
        closed: true,
        path: [
          { x: 0.5, y: 0.2 },
          { x: 0.82, y: 0.5 },
          { x: 0.5, y: 0.8 },
          { x: 0.18, y: 0.5 },
        ],
      },
    ],
    steps: [
      'Four players on the outside of the grid, two inside as defenders.',
      'The ball moves around the square. A defender who touches it goes in, and the player who lost it comes out.',
      'Six passes without a touch wins a point for the outside team.',
      'Outside players hold their line, so the square is always there to receive.',
    ],
    points: [
      'Open body shape: receive side-on, never square to the passer.',
      'Pass with the far foot, then step into the space behind the cone.',
      'Head up before the ball arrives, so the next pass is already picked.',
    ],
    adjust:
      'Easier: three touches for the outside team and one defender. Harder: a second ball, added only after a win.',
  },
  gates: {
    area: 'channel',
    setup:
      'A 30 x 12 metre channel with three gates of cones across it. A warm-up that is really a first-touch drill.',
    marks: [
      { at: { x: 0.3, y: 0.3 }, kind: 'cone' },
      { at: { x: 0.3, y: 0.7 }, kind: 'cone' },
      { at: { x: 0.5, y: 0.3 }, kind: 'cone' },
      { at: { x: 0.5, y: 0.7 }, kind: 'cone' },
      { at: { x: 0.7, y: 0.3 }, kind: 'cone' },
      { at: { x: 0.7, y: 0.7 }, kind: 'cone' },
      { at: { x: 0.12, y: 0.5 }, kind: 'player', label: '1', side: 'att' },
      { at: { x: 0.16, y: 0.5 }, kind: 'ball' },
      { at: { x: 0.08, y: 0.25 }, kind: 'player', label: '2', side: 'att' },
      { at: { x: 0.15, y: 0.25 }, kind: 'player', label: '3', side: 'att' },
    ],
    routes: [
      {
        kind: 'dribble',
        path: [
          { x: 0.12, y: 0.5 },
          { x: 0.3, y: 0.44 },
          { x: 0.5, y: 0.56 },
          { x: 0.7, y: 0.44 },
          { x: 0.9, y: 0.5 },
        ],
      },
      {
        kind: 'run',
        path: [
          { x: 0.9, y: 0.5 },
          { x: 0.52, y: 0.25 },
          { x: 0.1, y: 0.25 },
        ],
      },
    ],
    steps: [
      'One player at a time dribbles from the start cone through every gate.',
      'Left foot through the odd gates, right foot through the even ones.',
      'Exit at speed and dribble back along the outside line to the queue.',
      'Every gate missed is a lap, so the touch stays honest.',
    ],
    points: [
      'The touch goes into the gap, not at the cone.',
      'Ball within a metre of the foot, even at speed.',
      'Look up between gates and call the next one out loud.',
    ],
    adjust: 'Easier: widen every gate to two metres. Harder: beat the clock, then race the player beside you.',
  },
  wall: {
    area: 'grid',
    setup:
      'Pairs twenty metres apart with a defender shadowing the middle. The oldest combination drill in the game, and the fastest to set out.',
    marks: [
      { at: { x: 0.1, y: 0.16 }, kind: 'cone' },
      { at: { x: 0.9, y: 0.16 }, kind: 'cone' },
      { at: { x: 0.1, y: 0.84 }, kind: 'cone' },
      { at: { x: 0.9, y: 0.84 }, kind: 'cone' },
      { at: { x: 0.86, y: 0.55 }, kind: 'cone' },
      { at: { x: 0.86, y: 0.75 }, kind: 'cone' },
      { at: { x: 0.16, y: 0.72 }, kind: 'player', label: 'A', side: 'att' },
      { at: { x: 0.19, y: 0.75 }, kind: 'ball' },
      { at: { x: 0.62, y: 0.3 }, kind: 'player', label: 'W', side: 'att' },
      { at: { x: 0.5, y: 0.55 }, kind: 'player', label: 'X', side: 'def' },
    ],
    routes: [
      {
        kind: 'pass',
        path: [
          { x: 0.16, y: 0.72 },
          { x: 0.62, y: 0.3 },
        ],
      },
      {
        kind: 'run',
        path: [
          { x: 0.16, y: 0.72 },
          { x: 0.44, y: 0.82 },
          { x: 0.78, y: 0.64 },
        ],
      },
      {
        kind: 'pass',
        path: [
          { x: 0.62, y: 0.3 },
          { x: 0.8, y: 0.64 },
        ],
      },
      {
        kind: 'dribble',
        path: [
          { x: 0.8, y: 0.64 },
          { x: 0.92, y: 0.66 },
        ],
      },
    ],
    steps: [
      'A carrier and a wall per line, the wall standing at an angle.',
      'The carrier passes to the wall and immediately runs past the defender.',
      'The wall lays it off first time into the runner space.',
      'Carry through the gate cones, then go to the back of the queue.',
    ],
    points: [
      'The wall does not drift: feet set, body open to both player and space.',
      'Pass and run are one movement - the run starts as the ball is released.',
      'Lay-off with the inside of the foot, weighted into the run.',
    ],
    adjust: 'Easier: no defender and two touches for the wall. Harder: the wall must turn after releasing.',
  },
  overlap: {
    area: 'half',
    setup: 'Half a pitch, one goal. Two attackers play from the halfway line towards it against one defender.',
    marks: [
      { at: { x: 0.8, y: 0.36 }, kind: 'player', label: '1', side: 'att' },
      { at: { x: 0.84, y: 0.38 }, kind: 'ball' },
      { at: { x: 0.72, y: 0.68 }, kind: 'player', label: '2', side: 'att' },
      { at: { x: 0.5, y: 0.5 }, kind: 'player', label: 'X', side: 'def' },
      { at: { x: 0.11, y: 0.5 }, kind: 'player', label: 'GK', side: 'keeper' },
    ],
    routes: [
      {
        kind: 'pass',
        path: [
          { x: 0.8, y: 0.36 },
          { x: 0.62, y: 0.66 },
        ],
      },
      {
        kind: 'run',
        path: [
          { x: 0.8, y: 0.36 },
          { x: 0.46, y: 0.26 },
        ],
      },
      {
        kind: 'pass',
        path: [
          { x: 0.62, y: 0.66 },
          { x: 0.34, y: 0.4 },
        ],
      },
      {
        kind: 'shot',
        path: [
          { x: 0.34, y: 0.4 },
          { x: 0.08, y: 0.46 },
        ],
      },
    ],
    steps: [
      'Two attackers start outside the halfway line against one defender.',
      'The carrier holds width while the second runs around behind the defender.',
      'Play the give-and-go and arrive in the box together.',
      'Shoot first time from the edge of the area, then reset with the keeper.',
    ],
    points: [
      'The overlap starts on the pass, never before it.',
      'Front shoulder over the ball when shooting across yourself.',
      'Defender: step to the ball, then drop to cover the runner.',
    ],
    adjust: 'Easier: a two-second head start for the attackers. Harder: make it 3v2 with a second ball.',
  },
  press: {
    area: 'grid',
    setup: 'A 20 x 15 grid with a gate in each half of one short side. Teaches when to press, not only how hard.',
    marks: [
      { at: { x: 0.1, y: 0.12 }, kind: 'cone' },
      { at: { x: 0.9, y: 0.12 }, kind: 'cone' },
      { at: { x: 0.2, y: 0.9 }, kind: 'cone' },
      { at: { x: 0.36, y: 0.9 }, kind: 'cone' },
      { at: { x: 0.64, y: 0.9 }, kind: 'cone' },
      { at: { x: 0.8, y: 0.9 }, kind: 'cone' },
      { at: { x: 0.25, y: 0.2 }, kind: 'player', label: '1', side: 'att' },
      { at: { x: 0.5, y: 0.14 }, kind: 'player', label: '2', side: 'att' },
      { at: { x: 0.75, y: 0.2 }, kind: 'player', label: '3', side: 'att' },
      { at: { x: 0.54, y: 0.16 }, kind: 'ball' },
      { at: { x: 0.36, y: 0.52 }, kind: 'player', label: 'X', side: 'def' },
      { at: { x: 0.6, y: 0.58 }, kind: 'player', label: 'Y', side: 'def' },
      { at: { x: 0.46, y: 0.8 }, kind: 'player', label: 'Z', side: 'def' },
    ],
    routes: [
      {
        kind: 'pass',
        path: [
          { x: 0.5, y: 0.14 },
          { x: 0.75, y: 0.2 },
        ],
      },
      {
        kind: 'run',
        path: [
          { x: 0.36, y: 0.52 },
          { x: 0.7, y: 0.24 },
        ],
      },
      {
        kind: 'run',
        path: [
          { x: 0.6, y: 0.58 },
          { x: 0.52, y: 0.34 },
        ],
      },
      {
        kind: 'run',
        path: [
          { x: 0.46, y: 0.8 },
          { x: 0.3, y: 0.56 },
        ],
      },
    ],
    steps: [
      'Three attackers along one side keep the ball, three defenders press them.',
      'A backward or heavy pass is the trigger: the nearest goes, the other two tighten.',
      'Win it and pass out through either gate on the far line to score.',
      'Six seconds to win it, or the pressers rotate out of the grid.',
    ],
    points: [
      'Curved run to the ball: force it towards the sideline, not through the middle.',
      'The second defender sits on the lane behind the presser.',
      'Somebody calls the trigger - the press starts on the word, not the touch.',
    ],
    adjust: 'Easier: press against two attackers so the numbers favour the defenders. Harder: no gates, shoot at a cone.',
  },
  shuttle: {
    area: 'grid',
    setup: 'Four cones in a T, a ten metre stem and a ten metre bar. Fits a warm-up or a finisher.',
    marks: [
      { at: { x: 0.5, y: 0.74 }, kind: 'cone' },
      { at: { x: 0.5, y: 0.2 }, kind: 'cone' },
      { at: { x: 0.2, y: 0.2 }, kind: 'cone' },
      { at: { x: 0.8, y: 0.2 }, kind: 'cone' },
      { at: { x: 0.5, y: 0.88 }, kind: 'player', label: 'P', side: 'att' },
      { at: { x: 0.3, y: 0.88 }, kind: 'player', label: 'Q', side: 'att' },
      { at: { x: 0.7, y: 0.88 }, kind: 'player', label: 'R', side: 'att' },
    ],
    routes: [
      {
        kind: 'run',
        path: [
          { x: 0.5, y: 0.74 },
          { x: 0.5, y: 0.2 },
        ],
      },
      {
        kind: 'run',
        path: [
          { x: 0.5, y: 0.2 },
          { x: 0.2, y: 0.2 },
        ],
      },
      {
        kind: 'run',
        path: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
        ],
      },
      {
        kind: 'run',
        path: [
          { x: 0.8, y: 0.2 },
          { x: 0.5, y: 0.74 },
        ],
      },
    ],
    steps: [
      'Sprint the stem of the T and touch the cone in the middle of the bar.',
      'Defensive shuffle to the left arm, then across to the right.',
      'Back-pedal from the right arm to the base cone.',
      'Full recovery between rounds; two rounds is a set.',
    ],
    points: [
      'Low hips on the shuffle, with no feet crossing.',
      'Push off the outside foot to change direction.',
      'Chest over the thighs and eyes up, not looking at the feet.',
    ],
    adjust: 'Easier: halve the distances and drop the back-pedal. Harder: call left or right as they reach the top.',
  },
  cross: {
    area: 'box',
    setup: 'A penalty box with a channel down one side for the crosser. Finishing with real speed and real pressure.',
    marks: [
      { at: { x: 0.9, y: 0.28 }, kind: 'player', label: 'F', side: 'att' },
      { at: { x: 0.93, y: 0.33 }, kind: 'ball' },
      { at: { x: 0.74, y: 0.72 }, kind: 'player', label: '7', side: 'att' },
      { at: { x: 0.62, y: 0.86 }, kind: 'cone' },
      { at: { x: 0.26, y: 0.44 }, kind: 'player', label: '9', side: 'att' },
      { at: { x: 0.24, y: 0.62 }, kind: 'player', label: '11', side: 'att' },
      { at: { x: 0.36, y: 0.52 }, kind: 'player', label: 'X', side: 'def' },
      { at: { x: 0.09, y: 0.5 }, kind: 'player', label: 'GK', side: 'keeper' },
    ],
    routes: [
      {
        kind: 'pass',
        path: [
          { x: 0.9, y: 0.28 },
          { x: 0.74, y: 0.7 },
        ],
      },
      {
        kind: 'dribble',
        path: [
          { x: 0.74, y: 0.72 },
          { x: 0.44, y: 0.82 },
        ],
      },
      {
        kind: 'pass',
        path: [
          { x: 0.44, y: 0.82 },
          { x: 0.22, y: 0.5 },
        ],
      },
      {
        kind: 'shot',
        path: [
          { x: 0.22, y: 0.5 },
          { x: 0.07, y: 0.42 },
        ],
      },
    ],
    steps: [
      'The feeder plays the wide player into the channel, first time where possible.',
      'Drive to the byline and cross before the defence is set.',
      'One attacker takes the near post, one the penalty spot, one the back post.',
      'Finish, collect and repeat five times from one side, then change.',
    ],
    points: [
      'Strikers check off the shoulder then go in behind - nobody walks into the box.',
      'Cross into the stride of the runner, waist height, not floating.',
      'A real shot every time: no walking back to the feeder.',
    ],
    adjust: 'Easier: no defender and a set cross. Harder: two touches to finish, counter if the defence wins it.',
  },
  buildOut: {
    area: 'half',
    setup: 'Half a pitch with one goal. The team in possession plays out from its own goalkeeper to the halfway line.',
    marks: [
      { at: { x: 0.08, y: 0.5 }, kind: 'player', label: 'GK', side: 'keeper' },
      { at: { x: 0.22, y: 0.32 }, kind: 'player', label: '4', side: 'att' },
      { at: { x: 0.22, y: 0.68 }, kind: 'player', label: '5', side: 'att' },
      { at: { x: 0.44, y: 0.14 }, kind: 'player', label: '2', side: 'att' },
      { at: { x: 0.44, y: 0.86 }, kind: 'player', label: '7', side: 'att' },
      { at: { x: 0.46, y: 0.5 }, kind: 'player', label: '8', side: 'att' },
      { at: { x: 0.66, y: 0.34 }, kind: 'player', label: 'X', side: 'def' },
      { at: { x: 0.66, y: 0.66 }, kind: 'player', label: 'Y', side: 'def' },
      { at: { x: 0.78, y: 0.5 }, kind: 'player', label: 'Z', side: 'def' },
    ],
    routes: [
      {
        kind: 'pass',
        path: [
          { x: 0.08, y: 0.5 },
          { x: 0.22, y: 0.32 },
        ],
      },
      {
        kind: 'pass',
        path: [
          { x: 0.22, y: 0.32 },
          { x: 0.44, y: 0.14 },
        ],
      },
      {
        kind: 'pass',
        path: [
          { x: 0.44, y: 0.14 },
          { x: 0.46, y: 0.5 },
        ],
      },
      {
        kind: 'pass',
        path: [
          { x: 0.46, y: 0.5 },
          { x: 0.44, y: 0.86 },
        ],
      },
      {
        kind: 'run',
        path: [
          { x: 0.44, y: 0.86 },
          { x: 0.86, y: 0.78 },
        ],
      },
    ],
    steps: [
      'Goalkeeper and four defenders against three pressers.',
      'Pressers stay beyond the halfway line until the ball crosses it.',
      'The wide defenders hold the full width and stay level with the goalkeeper.',
      'Getting the ball past the line wins a point; a turnover keeps the pressers on.',
    ],
    points: [
      'Goalkeeper confident on both feet and willing to take the first pass.',
      'Everyone receives facing play, never square to their own goal.',
      'When the press commits, the middle player is free - find them.',
    ],
    adjust: 'Easier: drop to 4v2 so the first pass is always on. Harder: 4v4, and the point needs a pass past the line.',
  },
  duel: {
    area: 'half',
    setup: 'The wing from the halfway line into the box, one goal, one keeper. The duel every coach knows.',
    marks: [
      { at: { x: 0.86, y: 0.44 }, kind: 'cone' },
      { at: { x: 0.86, y: 0.9 }, kind: 'cone' },
      { at: { x: 0.34, y: 0.44 }, kind: 'cone' },
      { at: { x: 0.34, y: 0.9 }, kind: 'cone' },
      { at: { x: 0.74, y: 0.66 }, kind: 'player', label: 'A', side: 'att' },
      { at: { x: 0.78, y: 0.7 }, kind: 'ball' },
      { at: { x: 0.6, y: 0.5 }, kind: 'player', label: 'X', side: 'def' },
      { at: { x: 0.09, y: 0.5 }, kind: 'player', label: 'GK', side: 'keeper' },
    ],
    routes: [
      {
        kind: 'dribble',
        path: [
          { x: 0.74, y: 0.66 },
          { x: 0.56, y: 0.56 },
        ],
      },
      {
        kind: 'dribble',
        path: [
          { x: 0.56, y: 0.56 },
          { x: 0.42, y: 0.74 },
        ],
      },
      {
        kind: 'shot',
        path: [
          { x: 0.42, y: 0.74 },
          { x: 0.08, y: 0.58 },
        ],
      },
    ],
    steps: [
      'The attacker starts with the ball at the far cone, the defender level with the next one.',
      'Beat the defender and shoot inside eight seconds.',
      'If the defender wins it, carrying the ball to the far cone scores instead.',
      'Winner stays on, loser jogs to the back of the queue.',
    ],
    points: [
      'Sell the change of speed: slow, then a step past.',
      'Put the body between the defender and the ball entering the box.',
      'Defender: show one side, hold your feet, then get a body in the shot lane.',
    ],
    adjust: 'Easier: the attacker starts two metres past the defender. Harder: 2v2 with a recovering pair.',
  },
  protect: {
    area: 'grid',
    setup: 'A 25 x 20 grid. Everyone in the squad is keeping, pressing, or waiting for the swap.',
    marks: [
      { at: { x: 0.08, y: 0.1 }, kind: 'cone' },
      { at: { x: 0.92, y: 0.1 }, kind: 'cone' },
      { at: { x: 0.08, y: 0.9 }, kind: 'cone' },
      { at: { x: 0.92, y: 0.9 }, kind: 'cone' },
      { at: { x: 0.2, y: 0.26 }, kind: 'player', label: '1', side: 'att' },
      { at: { x: 0.5, y: 0.16 }, kind: 'player', label: '2', side: 'att' },
      { at: { x: 0.8, y: 0.28 }, kind: 'player', label: '3', side: 'att' },
      { at: { x: 0.78, y: 0.74 }, kind: 'player', label: '4', side: 'att' },
      { at: { x: 0.48, y: 0.86 }, kind: 'player', label: '5', side: 'att' },
      { at: { x: 0.18, y: 0.7 }, kind: 'player', label: '6', side: 'att' },
      { at: { x: 0.42, y: 0.44 }, kind: 'player', label: 'X', side: 'def' },
      { at: { x: 0.62, y: 0.56 }, kind: 'player', label: 'Y', side: 'def' },
      { at: { x: 0.48, y: 0.72 }, kind: 'player', label: 'Z', side: 'def' },
    ],
    routes: [
      {
        kind: 'pass',
        closed: true,
        path: [
          { x: 0.2, y: 0.26 },
          { x: 0.5, y: 0.16 },
          { x: 0.8, y: 0.28 },
          { x: 0.78, y: 0.74 },
          { x: 0.48, y: 0.86 },
          { x: 0.18, y: 0.7 },
        ],
      },
      {
        kind: 'run',
        path: [
          { x: 0.42, y: 0.44 },
          { x: 0.5, y: 0.22 },
        ],
      },
      {
        kind: 'run',
        path: [
          { x: 0.62, y: 0.56 },
          { x: 0.74, y: 0.4 },
        ],
      },
    ],
    steps: [
      'Six keep the ball across the grid, three work in the middle to win it.',
      'Five passes scores a point; dribbling out of the grid counts as two.',
      'Whoever loses it goes in, and the pressers become the keepers.',
      'Hold the edges: the shape only works with the width taken up.',
    ],
    points: [
      'Create an angle. Hidden behind your marker, you are not an option.',
      'First touch away from pressure, into space you can play from.',
      'Lose it, press it: three seconds to win it back before dropping.',
    ],
    adjust: 'Easier: eight keepers against three, with three touches. Harder: four pressers and two balls.',
  },
};

export const DRILL_LIBRARY: Drill[] = [
  { id: 'lib-drill-rondo', name: 'Rondo 4v2', focus: 'Passing', minutes: 15, notes: null, plan: PLANS.rondo! },
  { id: 'lib-drill-gates', name: 'First-Touch Gates', focus: 'First touch', minutes: 12, notes: null, plan: PLANS.gates! },
  { id: 'lib-drill-wall', name: 'Wall Pass and Go', focus: 'Passing', minutes: 12, notes: null, plan: PLANS.wall! },
  { id: 'lib-drill-overlap', name: '2v1 Overlap to Goal', focus: 'Attacking', minutes: 15, notes: null, plan: PLANS.overlap! },
  { id: 'lib-drill-press', name: 'Pressing Trigger 3v3', focus: 'Pressing', minutes: 12, notes: null, plan: PLANS.press! },
  { id: 'lib-drill-shuttle', name: 'T-Shuttle Agility', focus: 'Agility', minutes: 8, notes: null, plan: PLANS.shuttle! },
  { id: 'lib-drill-cross', name: 'Cross and Finish', focus: 'Finishing', minutes: 15, notes: null, plan: PLANS.cross! },
  { id: 'lib-drill-buildout', name: 'Build-Out Play 4v3', focus: 'Playing out from the back', minutes: 18, notes: null, plan: PLANS.buildOut! },
  { id: 'lib-drill-duel', name: '1v1 Wing Duel to Goal', focus: '1v1 dribbling', minutes: 10, notes: null, plan: PLANS.duel! },
  { id: 'lib-drill-protect', name: 'Possession 6v3', focus: 'Protecting the ball', minutes: 15, notes: null, plan: PLANS.protect! },
];
