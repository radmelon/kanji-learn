import { ScrollView } from 'react-native';
import { MilestoneBadge } from './MilestoneBadge';
import type { MilestoneEntry } from '../../constants/milestones';

type Props = {
  badges: MilestoneEntry[];
  onBadgePress: (e: MilestoneEntry) => void;
};

export function CoreBadgesRow({ badges, onBadgePress }: Props) {
  if (badges.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 12, paddingVertical: 4 }}
    >
      {badges.map((b, i) => (
        <MilestoneBadge key={`core-${b.type}-${b.threshold}-${i}`} entry={b} onPress={onBadgePress} />
      ))}
    </ScrollView>
  );
}
