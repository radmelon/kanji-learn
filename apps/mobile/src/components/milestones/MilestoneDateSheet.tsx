import { Modal, Pressable, Text, View } from 'react-native';
import { CATEGORY_DISPLAY, formatAchievedAt, type MilestoneEntry } from '../../constants/milestones';
import { colors } from '../../theme';

type Props = {
  entry: MilestoneEntry | null;
  onClose: () => void;
};

export function MilestoneDateSheet({ entry, onClose }: Props) {
  if (!entry) return null;
  const display = CATEGORY_DISPLAY[entry.type];

  let title = '';
  if (entry.type === 'kanji_seen' || entry.type === 'kanji_remembered' || entry.type === 'kanji_burned') {
    title = `${entry.threshold} ${display.label}`;
  } else if (entry.type === 'streak_days') {
    title = `${entry.threshold}-day streak`;
  } else if (entry.type === 'jlpt_level') {
    title = `${entry.payload?.level} ${entry.payload?.tier}`;
  } else if (entry.type === 'grade_level') {
    title = `Grade ${entry.payload?.grade} ${entry.payload?.tier}`;
  }

  return (
    <Modal
      visible={entry != null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.bgCard,
            paddingTop: 24,
            paddingBottom: 48,
            paddingHorizontal: 24,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 48 }}>{display.emoji}</Text>
          <Text style={{ color: colors.textPrimary, fontSize: 20, fontWeight: '700', marginTop: 8 }}>
            {title}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, marginTop: 12 }}>
            {formatAchievedAt(entry.achievedAt)}
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
