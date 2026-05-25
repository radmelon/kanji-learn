import { Pressable, Text } from 'react-native';
import type { MilestoneEntry } from '../../constants/milestones';
import { milestoneTier, colors } from '../../theme';

type Props = {
  entry: MilestoneEntry;
  onPress: (e: MilestoneEntry) => void;
};

export function GradeBadge({ entry, onPress }: Props) {
  const tier = entry.payload?.tier ?? 'bronze';
  const palette = milestoneTier[tier];
  return (
    <Pressable
      onPress={() => onPress(entry)}
      accessibilityRole="button"
      accessibilityLabel={`Grade ${entry.payload?.grade} ${tier}. Tap to see date earned.`}
      style={{
        backgroundColor: palette.bg,
        borderColor: palette.border,
        borderWidth: 2,
        borderRadius: 14,
        paddingHorizontal: 18,
        paddingVertical: 14,
        minWidth: 104,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: 28 }}>🏅</Text>
      <Text style={{ color: colors.textPrimary, fontWeight: '700', marginTop: 6, fontSize: 14 }}>
        Grade {entry.payload?.grade}
      </Text>
      <Text style={{ color: palette.label, fontWeight: '700', fontSize: 12, letterSpacing: 1.5, marginTop: 4 }}>
        {tier.toUpperCase()}
      </Text>
    </Pressable>
  );
}
