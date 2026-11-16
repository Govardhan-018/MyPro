/**
 * The phone's navigation — the web's `MobileNavSheet`, as a native sheet.
 *
 * Collapsed it is the familiar five-tab bar. Dragged (or tapped) upward it
 * becomes a sheet holding *every* section plus the global controls, so
 * nothing is unreachable just because the bar only fits five.
 *
 * It tracks the finger the whole way, as the web's does: the sheet is one
 * absolutely-positioned surface translated between a closed and an open
 * offset, so a drag moves it live and a release springs it to whichever end
 * it was heading for. The earlier version only acted on release, which read
 * as a button that happened to tolerate a swipe.
 */
import { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, View } from 'react-native';
import { Text } from './Typography';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, useTheme } from '../theme';
import type { IconName } from './ui';

/** Every section the app can show. */
export type View_ =
  | 'today'
  | 'calendar'
  | 'library'
  | 'knowledge'
  | 'health'
  | 'schedules'
  | 'assistant';

/** Kept as `Tab` for the call sites that already import it. */
export type Tab = View_;

interface NavItem {
  id: View_;
  /** The drawer's full name, as the web's `navItems` has it. */
  label: string;
  /** The bar has room for a word, not a title (`SHORT_LABELS`). */
  short: string;
  icon: IconName;
  iconActive: IconName;
}

const ITEMS: NavItem[] = [
  { id: 'today', label: 'Today', short: 'Today', icon: 'home-outline', iconActive: 'home' },
  {
    id: 'calendar',
    label: 'Calendar',
    short: 'Calendar',
    icon: 'calendar-outline',
    iconActive: 'calendar',
  },
  {
    id: 'library',
    label: 'My Library',
    short: 'Library',
    icon: 'library-outline',
    iconActive: 'library',
  },
  {
    id: 'knowledge',
    label: 'My Knowledge',
    short: 'Knowledge',
    icon: 'bulb-outline',
    iconActive: 'bulb',
  },
  {
    id: 'health',
    label: 'Health Records',
    short: 'Health',
    icon: 'heart-outline',
    iconActive: 'heart',
  },
  {
    id: 'schedules',
    label: 'Schedules',
    short: 'Schedules',
    icon: 'alarm-outline',
    iconActive: 'alarm',
  },
  {
    id: 'assistant',
    label: 'AI Assistant',
    short: 'Assistant',
    icon: 'sparkles-outline',
    iconActive: 'sparkles',
  },
];

/** The ids that stay on the collapsed bar, in order. */
const TAB_IDS: View_[] = ['today', 'calendar', 'assistant', 'library', 'health'];

/** Past this much travel, releasing carries the sheet the rest of the way. */
const OPEN_THRESHOLD = 46;

/**
 * What the collapsed bar occupies: the grabber, the 62px tab row and the
 * bottom inset. Screens reserve exactly this much so nothing hides beneath
 * it — the native counterpart of the web's `.view-scroll` padding.
 */
export const NAV_COLLAPSED_HEIGHT = 100;

const assistantTile = {
  width: 44,
  height: 34,
  borderRadius: 13,
  alignItems: 'center',
  justifyContent: 'center',
} as const;

/** `.mobile-nav-kicker`. */
const kickerStyle = {
  marginTop: 14,
  marginBottom: 9,
  color: 'rgba(255,255,255,0.3)',
  fontSize: 9.5,
  letterSpacing: 1.3,
} as const;

export function TabBar({
  active,
  onChange,
  onOpenSettings,
  onSignOut,
}: {
  active: View_;
  onChange: (tab: View_) => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const { colorMode, accent, setColorMode } = useTheme();

  /** The drawer's measured height — exactly how far the sheet travels. */
  const [drawerHeight, setDrawerHeight] = useState(0);
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;

  /** 0 = fully open, `drawerHeight` = closed. Follows the finger mid-drag. */
  const offset = useRef(new Animated.Value(0)).current;
  const travel = useRef(0);
  travel.current = drawerHeight;

  const settle = (toOpen: boolean) => {
    setOpen(toOpen);
    openRef.current = toOpen;
    Animated.spring(offset, {
      toValue: toOpen ? 0 : travel.current,
      useNativeDriver: true,
      bounciness: 2,
      speed: 14,
    }).start();
  };

  // Rest closed as soon as the drawer has been measured.
  const measured = useRef(false);
  if (drawerHeight > 0 && !measured.current) {
    measured.current = true;
    offset.setValue(drawerHeight);
  }

  const drag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 4,
        onPanResponderGrant: () => offset.stopAnimation(),
        onPanResponderMove: (_event, gesture) => {
          const from = openRef.current ? 0 : travel.current;
          // Clamped, so the sheet cannot be flung past either end.
          offset.setValue(Math.max(0, Math.min(travel.current, from + gesture.dy)));
        },
        onPanResponderRelease: (_event, gesture) => {
          const movedFar = Math.abs(gesture.dy) > OPEN_THRESHOLD;
          const flicked = Math.abs(gesture.vy) > 0.5;
          // A press with no travel is a tap: toggle it.
          if (!movedFar && !flicked) {
            settle(!openRef.current);
            return;
          }
          settle(gesture.dy < 0 || gesture.vy < 0);
        },
        onPanResponderTerminate: () => settle(openRef.current),
      }),
    // Everything it reads lives in refs, so the responder is built once and
    // still sees current values; rebuilding would drop a live gesture.
    [offset],
  );

  const go = (id: View_) => {
    settle(false);
    onChange(id);
  };

  /** The backdrop fades in as the sheet rises. */
  const backdropOpacity =
    drawerHeight > 0
      ? offset.interpolate({
          inputRange: [0, drawerHeight],
          outputRange: [1, 0],
          extrapolate: 'clamp',
        })
      : 0;

  const chevronRotation =
    drawerHeight > 0
      ? offset.interpolate({
          inputRange: [0, drawerHeight],
          outputRange: ['180deg', '0deg'],
          extrapolate: 'clamp',
        })
      : '0deg';

  return (
    <>
      {/* `.mobile-nav-backdrop` — only takes touches once the sheet is up. */}
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.55)',
          opacity: backdropOpacity,
        }}
      >
        <Pressable
          style={{ flex: 1 }}
          onPress={() => settle(false)}
          accessibilityLabel="Close navigation"
        />
      </Animated.View>

      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          transform: [{ translateY: offset }],
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.12)',
          borderTopLeftRadius: radius.card,
          borderTopRightRadius: radius.card,
          overflow: 'hidden',
        }}
      >
        {/* The web blurs whatever the bar covers. */}
        <BlurView
          intensity={44}
          tint="dark"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.chrome,
          }}
          experimentalBlurMethod="dimezisBlurView"
        />

        {/* `.mobile-nav-grabber` — the handle the whole sheet follows. */}
        <View
          {...drag.panHandlers}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? 'Close navigation' : 'More sections'}
          style={{ alignItems: 'center', gap: 3, paddingTop: 8, paddingBottom: 4 }}
        >
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: radius.pill,
              backgroundColor: 'rgba(255,255,255,0.22)',
            }}
          />
          <Animated.View style={{ transform: [{ rotate: chevronRotation }] }}>
            <Ionicons name="chevron-up" size={13} color="rgba(255,255,255,0.35)" />
          </Animated.View>
        </View>

        {/* `.mobile-nav-tabs` — five equal columns. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            height: 62,
            paddingBottom: 12,
          }}
        >
          {TAB_IDS.map((id) => {
            const item = ITEMS.find((navItem) => navItem.id === id);
            if (!item) return null;
            const selected = active === id;

            if (id === 'assistant') {
              return (
                <Pressable
                  key={id}
                  onPress={() => go(id)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel="AI Assistant"
                  style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
                >
                  {colorMode ? (
                    <LinearGradient
                      colors={['#b69af5', '#71b7f5']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={assistantTile}
                    >
                      <Ionicons name="sparkles" size={20} color="#000000" />
                    </LinearGradient>
                  ) : (
                    <View style={[assistantTile, { backgroundColor: colors.text }]}>
                      <Ionicons name="sparkles" size={20} color="#000000" />
                    </View>
                  )}
                </Pressable>
              );
            }

            const tint = selected
              ? colorMode
                ? accent
                : colors.text
              : 'rgba(255,255,255,0.5)';
            return (
              <Pressable
                key={id}
                onPress={() => go(id)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={item.label}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  paddingHorizontal: 2,
                }}
              >
                <Ionicons name={selected ? item.iconActive : item.icon} size={20} color={tint} />
                <Text numberOfLines={1} style={{ color: tint, fontSize: 9 }}>
                  {item.short}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* `.mobile-nav-drawer` — measured once; its height is the travel. */}
        <View
          onLayout={(event) => {
            const height = Math.round(event.nativeEvent.layout.height);
            if (height > 0 && height !== drawerHeight) setDrawerHeight(height);
          }}
        >
          <ScrollView
            style={{ maxHeight: 360 }}
            contentContainerStyle={{
              paddingHorizontal: space.gutter,
              paddingTop: 4,
              paddingBottom: 18,
            }}
          >
            <Text style={kickerStyle}>GO TO</Text>
            {/* `.mobile-nav-grid` — three columns of cards. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {ITEMS.map((item) => {
                const selected = active === item.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => go(item.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={item.label}
                    style={{
                      width: '31.8%',
                      gap: 9,
                      paddingHorizontal: 12,
                      paddingVertical: 13,
                      borderWidth: 1,
                      borderRadius: radius.md,
                      borderColor: selected
                        ? colorMode
                          ? accent
                          : colors.text
                        : 'rgba(255,255,255,0.1)',
                      backgroundColor: selected
                        ? colorMode
                          ? 'rgba(182,154,245,0.16)'
                          : colors.text
                        : 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <Ionicons
                      name={selected ? item.iconActive : item.icon}
                      size={18}
                      color={
                        selected ? (colorMode ? accent : '#000000') : 'rgba(255,255,255,0.75)'
                      }
                    />
                    <Text
                      numberOfLines={2}
                      style={{
                        color: selected
                          ? colorMode
                            ? accent
                            : '#000000'
                          : 'rgba(255,255,255,0.75)',
                        fontSize: 11.5,
                      }}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={kickerStyle}>QUICK</Text>
            <View style={{ gap: 6 }}>
              <ActionRow
                icon="settings-outline"
                label="Settings"
                onPress={() => {
                  settle(false);
                  onOpenSettings();
                }}
              />
              <ActionRow
                icon="color-palette-outline"
                label="Color Mode"
                onPress={() => setColorMode(!colorMode)}
                trailing={
                  <View
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 5,
                      borderWidth: 1,
                      borderColor: colorMode ? accent : 'rgba(255,255,255,0.35)',
                      backgroundColor: colorMode ? accent : 'transparent',
                    }}
                  />
                }
              />
              <ActionRow
                icon="log-out-outline"
                label="Sign out"
                onPress={() => {
                  settle(false);
                  onSignOut();
                }}
              />
            </View>
          </ScrollView>
        </View>
      </Animated.View>
    </>
  );
}

/** `.mobile-nav-actions button`. */
function ActionRow({
  icon,
  label,
  onPress,
  trailing,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        paddingHorizontal: 13,
        paddingVertical: 12,
        borderWidth: 1,
        borderRadius: radius.sm,
        borderColor: 'rgba(255,255,255,0.08)',
        backgroundColor: pressed ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)',
      })}
    >
      <Ionicons name={icon} size={16} color="rgba(255,255,255,0.8)" />
      <Text style={{ flex: 1, color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>{label}</Text>
      {trailing}
    </Pressable>
  );
}
