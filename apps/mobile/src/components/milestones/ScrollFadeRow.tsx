import { useState, type ReactNode } from 'react';
import {
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors } from '../../theme';
import { computeFadeEdges } from './scrollFade';

const FADE_WIDTH = 28;

type Props = {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Colour the edges fade toward — should match the surrounding surface. */
  fadeColor?: string;
};

/**
 * Horizontal ScrollView with a soft edge-fade affordance: a gradient appears on
 * whichever side has more content beyond the viewport, signalling the row
 * scrolls. The fade is purely decorative (pointerEvents="none", hidden from
 * screen readers) — VoiceOver already traverses every child regardless of
 * scroll position, so this fixes *visual* discoverability only.
 */
export function ScrollFadeRow({ children, contentContainerStyle, fadeColor = colors.bgCard }: Props) {
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

  return (
    <View style={{ position: 'relative' }}>
      <ScrollView
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
        <FadeEdge side="left" height={viewport.height} color={fadeColor} />
      ) : null}
      {right && viewport.height > 0 ? (
        <FadeEdge side="right" height={viewport.height} color={fadeColor} />
      ) : null}
    </View>
  );
}

function FadeEdge({ side, height, color }: { side: 'left' | 'right'; height: number; color: string }) {
  const id = `milestone-fade-${side}`;
  // Opaque at the outer edge, transparent toward the content. Left is mirrored.
  const edgeOffset = side === 'right' ? '1' : '0';
  const innerOffset = side === 'right' ? '0' : '1';
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { position: 'absolute', top: 0, bottom: 0, width: FADE_WIDTH },
        side === 'right' ? { right: 0 } : { left: 0 },
      ]}
    >
      <Svg width={FADE_WIDTH} height={height}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset={innerOffset} stopColor={color} stopOpacity={0} />
            <Stop offset={edgeOffset} stopColor={color} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width={FADE_WIDTH} height={height} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
