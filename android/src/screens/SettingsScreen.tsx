/**
 * Settings — the structured home for everything that is not a tab.
 *
 * Replaces the old "More" drawer. Appearance (Color Mode), notifications
 * state (the one window into the Phase 11 clock), shortcuts to My Knowledge
 * and Schedules, and the account section with sign-out.
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { client } from '../lib/client';
import { ARM_WINDOW_HOURS, armUpcoming, registerForPush } from '../lib/notifications';
import { Card, FadeIn, SectionLabel, ToggleRow, type IconName } from '../components/ui';
import { colors, shared, space, type, useTheme } from '../theme';

type Destination = 'knowledge' | 'schedules';

export function SettingsScreen({
  onClose,
  onOpen,
  onSignOut,
}: {
  onClose: () => void;
  onOpen: (destination: Destination) => void;
  onSignOut: () => void;
}) {
  const { colorMode, setColorMode } = useTheme();
  const [armed, setArmed] = useState<number | null | undefined>(undefined);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void armUpcoming().then((count) => {
      if (active) setArmed(count);
    });
    void registerForPush().then((result) => {
      if (active && !result.ok) setPushNote(result.reason ?? null);
    });
    void client.auth
      .getSession()
      .then((session) => {
        if (active) setEmail(session?.user?.email ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const signOut = async () => {
    await client.auth.signOut().catch(() => undefined);
    onSignOut();
  };

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={{
        padding: space.gutter,
        paddingTop: 56,
        paddingBottom: 48,
        gap: space.md,
      }}
    >
      <FadeIn index={0}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surface,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="chevron-back" size={19} color={colors.text} />
          </Pressable>
          <Text style={type.title}>Settings</Text>
        </View>
      </FadeIn>

      <FadeIn index={1} style={{ gap: 10 }}>
        <SectionLabel>Appearance</SectionLabel>
        <Card>
          <ToggleRow
            title="Color Mode"
            subtitle="A restrained violet accent across the app. Off keeps MyPro monochrome."
            value={colorMode}
            onChange={setColorMode}
          />
        </Card>
      </FadeIn>

      <FadeIn index={2} style={{ gap: 10 }}>
        <SectionLabel>Your work</SectionLabel>
        <Card style={{ padding: 0, gap: 0 }}>
          <LinkRow
            icon="library-outline"
            title="My Knowledge"
            subtitle="Highlights, notes and questions from everything you read"
            onPress={() => onOpen('knowledge')}
          />
          <Divider />
          <LinkRow
            icon="repeat-outline"
            title="Schedules"
            subtitle="Recurring reminders and automated check-ins"
            onPress={() => onOpen('schedules')}
          />
        </Card>
      </FadeIn>

      <FadeIn index={3} style={{ gap: 10 }}>
        <SectionLabel>Notifications</SectionLabel>
        <Card>
          <Text style={{ color: colors.text, fontSize: 15.5 }}>
            {armed === undefined
              ? 'Checking…'
              : armed === null
                ? 'Not armed'
                : armed === 0
                  ? `Nothing due in the next ${ARM_WINDOW_HOURS} hours`
                  : `${armed} reminder${armed === 1 ? '' : 's'} armed`}
          </Text>
          <Text style={type.support}>
            {armed === null
              ? 'Allow notifications, and open the app once with a connection.'
              : `This phone fires reminders itself, so a brief still arrives with your laptop shut and the server asleep. It re-arms every time you open the app, covering the next ${ARM_WINDOW_HOURS} hours.`}
          </Text>
          {pushNote && (
            <Text style={type.label}>
              Push (for things nobody could schedule in advance) is not active: {pushNote}
            </Text>
          )}
        </Card>
      </FadeIn>

      <FadeIn index={4} style={{ gap: 10 }}>
        <SectionLabel>Account</SectionLabel>
        <Card style={{ padding: 0, gap: 0 }}>
          {!!email && (
            <>
              <View style={{ padding: space.md + 2, gap: 2 }}>
                <Text style={{ color: colors.text, fontSize: 15.5 }}>{email}</Text>
                <Text style={type.support}>Signed in through your Render backend</Text>
              </View>
              <Divider />
            </>
          )}
          <LinkRow
            icon="log-out-outline"
            title="Sign out"
            onPress={() => void signOut()}
            tone={colors.danger}
          />
        </Card>
      </FadeIn>
    </ScrollView>
  );
}

function LinkRow({
  icon,
  title,
  subtitle,
  onPress,
  tone = colors.text,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  tone?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: space.md + 2,
        backgroundColor: pressed ? 'rgba(255,255,255,0.04)' : 'transparent',
      })}
    >
      <Ionicons name={icon} size={19} color={tone === colors.text ? colors.textMuted : tone} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: tone, fontSize: 15.5 }}>{title}</Text>
        {!!subtitle && <Text style={type.support}>{subtitle}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

function Divider() {
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
        marginLeft: space.md + 2,
      }}
    />
  );
}
