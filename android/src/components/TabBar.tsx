/**
 * The phone's navigation — the web's `MobileNavSheet`, as a native sheet.
 *
 * Collapsed it is the familiar five-tab bar. Dragged (or tapped) upward it
 * becomes a sheet holding *every* section plus the global controls, so
 * nothing is unreachable just because the bar only fits five. Same five tabs,
 * same drawer contents, same copy as the browser.
 */
import { useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, Modal, PanResponder, Pressable, ScrollView, Text, View,
} from 'react-native';
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

/** Past this much upward travel, releasing opens the sheet. */
const OPEN_THRESHOLD = 46;

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
  const [open, setOpen] = useState(false);
  const { colorMode, accent, setColorMode } = useTheme();

  const go = (id: View_) => {
    setOpen(false);
    onChange(id);
  };

  /* A drag upward on the grabber opens the sheet, as on the web. */
  const openRef = useRef(open);
  openRef.current = open;
  const drag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 6,
        onPanResponderRelease: (_event, gesture) => {
          if (!openRef.current && -gesture.dy > OPEN_THRESHOLD) setOpen(true);
          else if (openRef.current && gesture.dy > OPEN_THRESHOLD) setOpen(false);
        },
      }),
    [],
  );

  const grabber = (
    <Pressable
      {...drag.panHandlers}
      onPress={() => setOpen((value) => !value)}
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
      <Ionicons
        name={open ? 'chevron-down' : 'chevron-up'}
        size={13}
        color="rgba(255,255,255,0.35)"
      />
    </Pressable>
  );

  const tabs = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        height: 62,
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
              style={{ width: '20%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
            >
              {/* `.mobile-nav-tabs .assistant-tab > span` — a 44x34 white tile. */}
              <View
                style={{
                  width: 44,
                  height: 34,
                  borderRadius: 13,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colorMode ? accent : colors.text,
                }}
              >
                <Ionicons name="sparkles" size={20} color="#000000" />
              </View>
            </Pressable>
          );
        }

        return (
          <Pressable
            key={id}
            onPress={() => go(id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={item.label}
            style={{
              width: '20%',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              paddingHorizontal: 2,
            }}
          >
            <Ionicons
              name={selected ? item.iconActive : item.icon}
              size={20}
              color={selected ? (colorMode ? accent : colors.text) : 'rgba(255,255,255,0.5)'}
            />
            <Text
              numberOfLines={1}
              style={{
                color: selected ? (colorMode ? accent : colors.text) : 'rgba(255,255,255,0.5)',
                fontSize: 9,
              }}
            >
              {item.short}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  /* The resting bar. The expanded state is a modal so it can dim the page. */
  if (!open) {
    return (
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.12)',
          borderTopLeftRadius: radius.card,
          borderTopRightRadius: radius.card,
          backgroundColor: colors.chrome,
          paddingBottom: 12,
        }}
      >
        {grabber}
        {tabs}
      </View>
    );
  }

  return (
    <>
      {/* Keep the layout's height while the sheet is up, so nothing shifts. */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.12)',
          backgroundColor: colors.chrome,
          paddingBottom: 12,
        }}
      >
        {grabber}
        {tabs}
      </View>

      <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          accessibilityLabel="Close navigation"
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
        />
        <ExpandedSheet
          grabber={grabber}
          tabs={tabs}
          active={active}
          onGo={go}
          colorMode={colorMode}
          accent={accent}
          onToggleColor={() => setColorMode(!colorMode)}
          onOpenSettings={() => {
            setOpen(false);
            onOpenSettings();
          }}
          onSignOut={() => {
            setOpen(false);
            onSignOut();
          }}
        />
      </Modal>
    </>
  );
}

function ExpandedSheet({
  grabber,
  tabs,
  active,
  onGo,
  colorMode,
  accent,
  onToggleColor,
  onOpenSettings,
  onSignOut,
}: {
  grabber: React.ReactNode;
  tabs: React.ReactNode;
  active: View_;
  onGo: (id: View_) => void;
  colorMode: boolean;
  accent: string;
  onToggleColor: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const rise = useRef(new Animated.Value(0)).current;

  useMemo(() => {
    Animated.timing(rise, {
      toValue: 1,
      duration: 340,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [rise]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: '86%',
        transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [320, 0] }) }],
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.12)',
        borderTopLeftRadius: radius.card,
        borderTopRightRadius: radius.card,
        backgroundColor: colors.chrome,
        paddingBottom: 12,
      }}
    >
      {grabber}
      {tabs}

      <ScrollView
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: space.gutter, paddingTop: 4, paddingBottom: 18 }}
      >
        <Text style={kickerStyle}>GO TO</Text>
        {/* `.mobile-nav-grid` — three columns of cards. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ITEMS.map((item) => {
            const selected = active === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => onGo(item.id)}
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
                  color={selected ? (colorMode ? accent : '#000000') : 'rgba(255,255,255,0.75)'}
                />
                <Text
                  numberOfLines={2}
                  style={{
                    color: selected ? (colorMode ? accent : '#000000') : 'rgba(255,255,255,0.75)',
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
          <ActionRow icon="settings-outline" label="Settings" onPress={onOpenSettings} />
          <ActionRow
            icon="color-palette-outline"
            label="Color Mode"
            onPress={onToggleColor}
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
          <ActionRow icon="log-out-outline" label="Sign out" onPress={onSignOut} />
        </View>
      </ScrollView>
    </Animated.View>
  );
}

/** `.mobile-nav-kicker`. */
const kickerStyle = {
  marginTop: 14,
  marginBottom: 9,
  color: 'rgba(255,255,255,0.3)',
  fontSize: 9.5,
  letterSpacing: 1.3,
} as const;

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

