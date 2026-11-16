/**
 * Settings — the web app's settings view, as a phone screen.
 *
 * Same heading ("Make MyPro yours.") and the same grouped rows: profile,
 * appearance, notifications, the other sections, then the account. The
 * notification group is also the one window into the Phase 11 clock, which is
 * invisible when it works — saying how many reminders are armed is how you
 * find out it has stopped before you miss something.
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '../components/Typography';
import { Ionicons } from '@expo/vector-icons';
import { client } from '../lib/client';
import { ARM_WINDOW_HOURS, armUpcoming, registerForPush } from '../lib/notifications';
import {
  Card, FadeIn, Kicker, PageHeading, ToggleRow, type IconName,
} from '../components/ui';
import type { View_ } from '../components/TabBar';
import { colors, radius, shared, space, type, useTheme } from '../theme';

export function SettingsScreen({
  onNavigate,
  onSignOut,
}: {
  onNavigate: (view: View_) => void;
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

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={{
        paddingHorizontal: space.gutter,
        paddingTop: 22,
        paddingBottom: 28,
      }}
    >
      <PageHeading
        eyebrow="Settings"
        title="Make MyPro yours."
        lede="Manage connected sources, preferences, and privacy."
      />

      {/* Profile */}
      <FadeIn index={1}>
        <Card style={{ gap: 10 }}>
          <Kicker>Profile</Kicker>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: colors.divider,
                backgroundColor: 'rgba(255,255,255,0.05)',
              }}
            >
              <Ionicons name="person-outline" size={18} color={colors.textMuted} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontSize: 15 }}>
                {email ?? 'Signed in'}
              </Text>
              <Text style={type.meta}>Signed in through your Render backend</Text>
            </View>
          </View>
        </Card>
      </FadeIn>

      {/* Appearance */}
      <FadeIn index={2} style={{ marginTop: 12 }}>
        <Card style={{ gap: 12 }}>
          <Kicker>Appearance</Kicker>
          <ToggleRow
            title="Color Mode"
            subtitle="A restrained violet accent across the app. Off keeps MyPro monochrome."
            value={colorMode}
            onChange={setColorMode}
          />
        </Card>
      </FadeIn>

      {/* Notifications */}
      <FadeIn index={3} style={{ marginTop: 12 }}>
        <Card style={{ gap: 8 }}>
          <Kicker>Notifications</Kicker>
          <Text style={{ color: colors.text, fontSize: 15 }}>
            {armed === undefined
              ? 'Checking…'
              : armed === null
                ? 'Not armed'
                : armed === 0
                  ? `Nothing due in the next ${ARM_WINDOW_HOURS} hours`
                  : `${armed} reminder${armed === 1 ? '' : 's'} armed`}
          </Text>
          <Text style={type.meta}>
            {armed === null
              ? 'Allow notifications, and open the app once with a connection.'
              : `This phone fires reminders itself, so a brief still arrives with your laptop shut and the server asleep. It re-arms every time you open the app, covering the next ${ARM_WINDOW_HOURS} hours.`}
          </Text>
          {!!pushNote && (
            <Text style={{ color: colors.textFaint, fontSize: 11.5, lineHeight: 17 }}>
              Push (for things nobody could schedule in advance) is not active: {pushNote}
            </Text>
          )}
        </Card>
      </FadeIn>

      {/* Other sections */}
      <FadeIn index={4} style={{ marginTop: 12 }}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingsRow
            icon="bulb-outline"
            title="My Knowledge"
            subtitle="Highlights, notes and questions from everything you read"
            onPress={() => onNavigate('knowledge')}
            first
          />
          <SettingsRow
            icon="alarm-outline"
            title="Schedules"
            subtitle="Recurring reminders and automated check-ins"
            onPress={() => onNavigate('schedules')}
          />
          <SettingsRow
            icon="heart-outline"
            title="Health Records"
            subtitle="Private, and read-only on the phone"
            onPress={() => onNavigate('health')}
          />
        </Card>
      </FadeIn>

      {/* Account */}
      <FadeIn index={5} style={{ marginTop: 12 }}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingsRow
            icon="log-out-outline"
            title="Sign out"
            onPress={onSignOut}
            tone={colors.danger}
            first
          />
        </Card>
      </FadeIn>

      <Text style={[type.meta, { textAlign: 'center', marginTop: 18 }]}>
        Connected sources and storage sync are managed in the web app.
      </Text>
    </ScrollView>
  );
}

/** `.settings-card button` — a 60px row with a hairline above it. */
function SettingsRow({
  icon,
  title,
  subtitle,
  onPress,
  tone = colors.text,
  first,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  tone?: string;
  first?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 18,
        paddingVertical: 15,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.dividerFaint,
        backgroundColor: pressed ? 'rgba(255,255,255,0.04)' : 'transparent',
      })}
    >
      <Ionicons
        name={icon}
        size={18}
        color={tone === colors.text ? colors.textMuted : tone}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: tone, fontSize: 15 }}>{title}</Text>
        {!!subtitle && <Text style={type.meta}>{subtitle}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}
