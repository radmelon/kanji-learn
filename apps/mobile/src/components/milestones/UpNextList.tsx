import { Text, View } from 'react-native';
import { CATEGORY_DISPLAY, type UpNextEntry } from '../../constants/milestones';
import { colors } from '../../theme';

export function UpNextList({ entries }: { entries: UpNextEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <View>
      <Text style={{
        color: colors.textSecondary,
        fontSize: 12,
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginBottom: 8,
      }}>
        Up next
      </Text>
      {entries.map((e, i) => {
        const display = CATEGORY_DISPLAY[e.type];
        let primary = '';
        let detail = '';
        if (e.type === 'streak_days') {
          primary = `${e.nextThreshold}-day streak`;
          detail = `${e.current} / ${e.target}`;
        } else if (e.type === 'kanji_seen' || e.type === 'kanji_remembered' || e.type === 'kanji_burned') {
          primary = `${e.nextThreshold} ${display.label}`;
          detail = `${e.current} / ${e.target}`;
        } else if (e.type === 'jlpt_level') {
          primary = `${e.payload?.level} ${e.payload?.tier}`;
        } else if (e.type === 'grade_level') {
          primary = `Grade ${e.payload?.grade} ${e.payload?.tier}`;
        }
        return (
          <View
            key={`upnext-${i}`}
            style={{
              flexDirection: 'row',
              paddingVertical: 10,
              borderBottomColor: colors.divider,
              borderBottomWidth: i === entries.length - 1 ? 0 : 1,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 16, marginRight: 8 }}>{display.emoji}</Text>
            <Text style={{ color: colors.textPrimary, fontSize: 14, flex: 1 }}>{primary}</Text>
            {detail ? (
              <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{detail}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
