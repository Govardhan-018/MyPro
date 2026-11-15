import { Pressable, Text, View } from 'react-native';
import { colors } from '../theme';

export type Tab = 'today' | 'library' | 'assistant' | 'calendar' | 'more';

const TABS: { key: Tab; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'library', label: 'Library' },
  { key: 'assistant', label: 'Chat' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'more', label: 'More' },
];

/**
 * Five tabs, no navigation library.
 *
 * react-navigation is a large dependency and a second mental model; the web
 * app already drives its sections from one `view` state and this mirrors it.
 * Worth revisiting only when a screen needs a real back stack — the reader
 * manages with a close button.
 */
export function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.background,
        paddingBottom: 18,
        paddingTop: 10,
      }}
    >
      {TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={{ flex: 1, alignItems: 'center', gap: 5, paddingVertical: 4 }}
          >
            {/* A dot rather than an icon set: one less asset pipeline, and it
                reads correctly in a monochrome design. */}
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 3,
                backgroundColor: selected ? colors.text : 'transparent',
              }}
            />
            <Text
              style={{
                color: selected ? colors.text : colors.textFaint,
                fontSize: 11.5,
                letterSpacing: 0.3,
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
