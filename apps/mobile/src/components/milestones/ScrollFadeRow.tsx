import { useRef, useState, type ReactNode } from 'react';
import {
  ScrollView,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors } from '../../theme';
import { computeFadeEdges } from './scrollFade';

// Wider than the first pass (was 28) so the darkening edge is actually
// perceptible, and a high-contrast chevron pill rides on top of it.
const FADE_WIDTH = 44;
const CHEVRON_SIZE = 26;

type Props = {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /**
   * Colour the edges fade toward. Defaults to the app background (darker than
   * the bgCard surface the row sits on) so the fade reads as a visible edge
   * vignette rather than dissolving into the same colour.
   */
  fadeColor?: string;
};

/**
 * Horizontal ScrollView with a scroll-affordance on whichever side has more
 * content beyond the viewport: a darkening edge gradient PLUS a high-contrast,
 * tappable chevron pill. The earlier fade-only version (fading toward the card
 * surface) was too subtle to notice — the operator missed off-screen JLPT
 * badges even when looking for them (B-207 follow-up). The chevron is the
 * primary cue; the fade reinforces it. Both are decorative for screen readers
 * (VoiceOver already traverses every child regardless of scroll position).
 */
export function ScrollFadeRow({ children, contentContainerStyle, fadeColor = colors.bg }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scrollX, setScrollX] = useState(0);

  const { left, right } = computeFadeEdges({
    contentWidth,
    viewportWidth: viewport.width,
    scrollX,
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setViewport({ width, height });
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setScrollX(e.nativeEvent.contentOffset.x);
  };

  // Page by ~80% of the viewport so a tap reveals the next group with a little
  // overlap for context.
  const pageBy = (dir: 'left' | 'right') => {
    const delta = Math.max(viewport.width * 0.8, 120);
    const next = dir === 'right' ? scrollX + delta : scrollX - delta;
    scrollRef.current?.scrollTo({ x: Math.max(0, next), animated: true });
  };

  return (
    <View style={{ position: 'relative' }}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={onLayout}
        onContentSizeChange={(w) => setContentWidth(w)}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={contentContainerStyle}
      >
        {children}
      </ScrollView>
      {left && viewport.height > 0 ? (
        <FadeEdge side="left" height={viewport.height} color={fadeColor} onPress={() => pageBy('left')} />
      ) : null}
      {right && viewport.height > 0 ? (
        <FadeEdge side="right" height={viewport.height} color={fadeColor} onPress={() => pageBy('right')} />
      ) : null}
    </View>
  );
}

function FadeEdge({
  side,
  height,
  color,
  onPress,
}: {
  side: 'left' | 'right';
  height: number;
  color: string;
  onPress: () => void;
}) {
  const id = `milestone-fade-${side}`;
  // Opaque at the outer edge, transparent toward the content. Left is mirrored.
  const edgeOffset = side === 'right' ? '1' : '0';
  const innerOffset = side === 'right' ? '0' : '1';
  return (
    <View
      pointerEvents="box-none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { position: 'absolute', top: 0, bottom: 0, width: FADE_WIDTH, justifyContent: 'center' },
        side === 'right' ? { right: 0, alignItems: 'flex-end' } : { left: 0, alignItems: 'flex-start' },
      ]}
    >
      <Svg width={FADE_WIDTH} height={height} style={{ position: 'absolute', top: 0 }} pointerEvents="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset={innerOffset} stopColor={color} stopOpacity={0} />
            <Stop offset={edgeOffset} stopColor={color} stopOpacity={0.92} />
          </LinearGradient>
        </Defs>
        <Rect width={FADE_WIDTH} height={height} fill={`url(#${id})`} />
      </Svg>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={{
          width: CHEVRON_SIZE,
          height: CHEVRON_SIZE,
          borderRadius: CHEVRON_SIZE / 2,
          backgroundColor: colors.bgElevated,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons
          name={side === 'right' ? 'chevron-forward' : 'chevron-back'}
          size={16}
          color={colors.textPrimary}
        />
      </TouchableOpacity>
    </View>
  );
}
