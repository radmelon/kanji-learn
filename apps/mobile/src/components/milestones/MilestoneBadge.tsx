import { Pressable, Text } from 'react-native';
import { CATEGORY_DISPLAY, type MilestoneEntry } from '../../constants/milestones';
import { colors } from '../../theme';

type Props = {
  entry: MilestoneEntry;
  onPress: (e: MilestoneEntry) => void;
};

export function MilestoneBadge({ entry, onPress }: Props) {
  const display = CATEGORY_DISPLAY[entry.type];

  let primary = '';
  if (entry.type === 'kanji_seen' || entry.type === 'kanji_remembered' || entry.type === 'kanji_burned') {
    primary = `${entry.threshold} ${display.label}`;
  } else if (entry.type === 'streak_days') {
    primary = `${entry.threshold}-day streak`;
  } else if (entry.type === 'jlpt_level') {
    primary = `${entry.payload?.level} ${entry.payload?.tier}`;
  }

  return (
    <Pressable
      onPress={() => onPress(entry)}
      accessibilityRole="button"
      accessibilityLabel={`${primary}. Tap to see date earned.`}
      style={{
        backgroundColor: colors.bgElevated,
        borderColor: colors.border,
        borderWidth: 2,
        borderRadius: 14,
        paddingHorizontal: 18,
        paddingVertical: 14,
        minWidth: 104,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: 28 }}>{display.emoji}</Text>
      <Text style={{ color: colors.textPrimary, fontWeight: '700', marginTop: 6, fontSize: 14, textAlign: 'center' }}>
        {primary}
      </Text>
    </Pressable>
  );
}
