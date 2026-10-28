import React from 'react';
import { Text, View } from 'react-native';
import { ci } from '../../shared/ci';
import { DrillDiagram } from './DrillDiagram';
import type { DrillPlan } from './drillPlan';

const LEGEND = [
  { color: ci.color.primary, text: 'team with it' },
  { color: ci.color.danger, text: 'opponents' },
  { color: ci.color.accent, text: 'movement' },
  { color: ci.color.text, text: 'ball' },
];

/**
 * Everything a coach needs to run one drill without a clipboard: the set-up, the picture, the
 * movement playing in order, and what to say to the players while it runs.
 */
export const DrillPlanCard: React.FC<{ plan: DrillPlan }> = ({ plan }) => (
  <View style={styles.card}>
    {plan.setup ? (
      <>
        <Text style={styles.label}>Set-up</Text>
        <Text style={styles.body}>{plan.setup}</Text>
      </>
    ) : null}

    <View style={styles.diagram}>
      <DrillDiagram plan={plan} />
    </View>
    <View style={styles.legend}>
      {LEGEND.map(entry => (
        <View key={entry.text} style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: entry.color }]} />
          <Text style={styles.legendText}>{entry.text}</Text>
        </View>
      ))}
    </View>

    {plan.steps.length > 0 ? (
      <>
        <Text style={styles.label}>What happens</Text>
        {plan.steps.map((step, index) => (
          <View key={`step-${index}`} style={styles.stepRow}>
            <Text style={styles.stepNumber}>{index + 1}</Text>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </>
    ) : null}

    {plan.points.length > 0 ? (
      <>
        <Text style={styles.label}>Watch for</Text>
        {plan.points.map((point, index) => (
          <View key={`point-${index}`} style={styles.stepRow}>
            <Text style={styles.bullet}>-</Text>
            <Text style={styles.stepText}>{point}</Text>
          </View>
        ))}
      </>
    ) : null}

    {plan.adjust ? (
      <>
        <Text style={styles.label}>Change it</Text>
        <Text style={styles.body}>{plan.adjust}</Text>
      </>
    ) : null}
  </View>
);

const styles = {
  card: { padding: 14, borderRadius: ci.radius.card, backgroundColor: ci.color.surface, gap: 8 },
  label: { color: ci.color.muted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  body: { color: ci.color.text, fontSize: 14, lineHeight: 20 },
  diagram: { alignItems: 'center', alignSelf: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: ci.color.muted, fontSize: 11, fontWeight: '700' },
  stepRow: { flexDirection: 'row', gap: 7, alignItems: 'flex-start' },
  stepNumber: {
    color: ci.color.accent,
    fontSize: 13,
    fontWeight: '800',
    width: 16,
    textAlign: 'right',
  },
  bullet: { color: ci.color.accent, fontSize: 14, fontWeight: '800', width: 16, textAlign: 'right' },
  stepText: { color: ci.color.text, fontSize: 14, lineHeight: 20, flex: 1, minWidth: 0 },
} as const;
