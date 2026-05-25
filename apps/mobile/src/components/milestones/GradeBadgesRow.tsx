import { ScrollView } from 'react-native';
import { GradeBadge } from './GradeBadge';
import type { MilestoneEntry } from '../../constants/milestones';

type Props = {
  badges: MilestoneEntry[];
  onBadgePress: (e: MilestoneEntry) => void;
};

export function GradeBadgesRow({ badges, onBadgePress }: Props) {
  if (badges.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 12, paddingVertical: 4 }}
    >
      {badges.map((b, i) => (
        <GradeBadge key={`grade-${b.payload?.grade}-${b.payload?.tier}-${i}`} entry={b} onPress={onBadgePress} />
      ))}
    </ScrollView>
  );
}
