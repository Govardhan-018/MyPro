/**
 * Bottom navigation — MYPRO 2.0.
 *
 * Five destinations with the assistant raised in the centre, as the product's
 * signature action. Dark glass surface, icon + label per tab, a small animated
 * dot under the active one, and real accessibility state on every item.
 * Still no navigation library: one `tab` state drives the app, as on the web.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, useTheme } from '../theme';
import type { IconName } from './ui';

export type Tab = 'today' | 'calendar' | 'assistant' | 'library' | 'health';

const TABS: { key: Tab; label: string; icon: IconName; iconActive: IconName }[] = [
  { key: 'today', label: 'Today', icon: 'sunny-outline', iconActive: 'sunny' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar-outline', iconActive: 'calendar' },
  { key: 'assistant', label: 'AI', icon: 'sparkles-outline', iconActive: 'sparkles' },
  { key: 'library', label: 'Library', icon: 'book-outline', iconActive: 'book' },
  { key: 'health', label: 'Health', icon: 'heart-outline', iconActive: 'heart' },
];

export function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  const { accent, colorMode } = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.borderStrong,
        backgroundColor: colors.glass,
        paddingBottom: 20,
        paddingTop: 8,
        paddingHorizontal: 6,
      }}
    >
      {TABS.map((tab) => {
        const selected = tab.key === active;
        const tint = selected ? (colorMode ? accent : colors.text) : colors.textFaint;

        if (tab.key === 'assistant') {
          return (
            <Pressable
              key={tab.key}
              onPress={() => onChange(tab.key)}
              accessibilityRole="tab"
              accessibilityLabel="AI assistant"
              accessibilityState={{ selected }}
              style={{ flex: 1, alignItems: 'center' }}
            >
              {/* The raised centre action: a filled disc floating above the bar. */}
              <View
                style={{
                  marginTop: -26,
                  width: 54,
                  height: 54,
                  borderRadius: 27,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: selected
                    ? colorMode
                      ? accent
                      : colors.text
                    : colors.surfaceHigh,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: selected ? 'transparent' : colors.borderStrong,
                  elevation: 10,
                  shadowColor: '#000',
                  shadowOpacity: 0.5,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 6 },
                }}
              >
                <Ionicons
                  name={selected ? 'sparkles' : 'sparkles-outline'}
                  size={22}
                  color={selected ? colors.background : colors.textMuted}
                />
              </View>
              <Text style={{ color: tint, fontSize: 10.5, letterSpacing: 0.3, marginTop: 4 }}>
                {tab.label}
              </Text>
            </Pressable>
          );
        }

        return (
          <TabItem
            key={tab.key}
            label={tab.label}
            icon={selected ? tab.iconActive : tab.icon}
            tint={tint}
            selected={selected}
            indicator={colorMode ? accent : colors.text}
            onPress={() => onChange(tab.key)}
          />
        );
      })}
    </View>
  );
}

function TabItem({
  label,
  icon,
  tint,
  selected,
  indicator,
  onPress,
}: {
  label: string;
  icon: IconName;
  tint: string;
  selected: boolean;
  indicator: string;
  onPress: () => void;
}) {
  const dot = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(dot, {
      toValue: selected ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [selected, dot]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4 }}
    >
      <Ionicons name={icon} size={21} color={tint} />
      <Text
        style={{
          color: tint,
          fontSize: 10.5,
          letterSpacing: 0.3,
          fontWeight: selected ? '600' : '400',
        }}
      >
        {label}
      </Text>
      <Animated.View
        style={{
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: indicator,
          opacity: dot,
          transform: [{ scale: dot }],
        }}
      />
    </Pressable>
  );
}
