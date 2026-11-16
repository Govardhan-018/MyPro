/**
 * Settings — the web app's settings view, as a phone screen.
 *
 * Same heading ("Make MyPro yours.") and the same grouped rows: profile,
 * appearance, notifications, the other sections, then the account. The
 * notification group is also the one window into the Phase 11 clock, which is
 * invisible when it works — saying how many reminders are armed is how you
 * find out it has stopped before you miss something.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View,
} from 'react-native';
import { Text } from '../components/Typography';
import { Ionicons } from '@expo/vector-icons';
import { client } from '../lib/client';
import { ARM_WINDOW_HOURS, armUpcoming, registerForPush } from '../lib/notifications';
import type { GmailAccountRow } from '@mypro/shared';
import {
  Card, FadeIn, GhostButton, Kicker, PageHeading, ToggleRow, useToast, type IconName,
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
  const toast = useToast();
  const { colorMode, setColorMode } = useTheme();
  const [armed, setArmed] = useState<number | null | undefined>(undefined);
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  /** Gmail, which Render owns end to end — it holds the OAuth tokens. */
  const [gmailConfigured, setGmailConfigured] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<GmailAccountRow[]>([]);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailNote, setGmailNote] = useState<string | null>(null);

  /** What the phone can read offline: books whose text has synced. */
  const [synced, setSynced] = useState<{ total: number; withText: number } | null>(null);

  const loadGmail = useCallback(async () => {
    try {
      const status = await client.api.gmail.status();
      setGmailConfigured(status.configured);
      if (!status.configured) return;
      setAccounts(await client.api.gmail.accounts());
    } catch {
      setGmailConfigured(false);
    }
  }, []);

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
    void loadGmail();
    void client.api.library
      .list({ type: 'book' })
      .then((rows) => {
        if (!active) return;
        const withText = rows.filter((row) => {
          const details = (row.book_details ?? {}) as Record<string, unknown>;
          const path = Array.isArray(details) ? undefined : details.pdf_json_path;
          return typeof path === 'string' && !!path;
        }).length;
        setSynced({ total: rows.length, withText });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loadGmail]);

  /**
   * Connecting opens Google's consent page in the browser: the flow ends on
   * Render, which is where the tokens live, so the mailbox is attached to the
   * account rather than to this device. Coming back and refreshing shows it.
   */
  const connectGmail = async () => {
    setGmailBusy(true);
    setGmailNote(null);
    try {
      const { url } = await client.api.gmail.connect();
      await Linking.openURL(url);
      setGmailNote('Finish in the browser, then tap Refresh.');
    } catch (caught) {
      setGmailNote(caught instanceof Error ? caught.message : 'Could not start the connection.');
    } finally {
      setGmailBusy(false);
    }
  };

  const syncGmail = async () => {
    setGmailBusy(true);
    setGmailNote(null);
    try {
      const { results } = await client.api.gmail.sync();
      const stored = results.reduce((sum, result) => sum + (result.stored ?? 0), 0);
      const failed = results.find((result) => result.error);
      setGmailNote(
        failed?.error
          ? failed.error
          : stored
            ? `${stored} new message${stored === 1 ? '' : 's'}.`
            : 'Already up to date.',
      );
      await loadGmail();
    } catch (caught) {
      setGmailNote(caught instanceof Error ? caught.message : 'Could not sync.');
    } finally {
      setGmailBusy(false);
    }
  };

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

      {/* Connected services */}
      <FadeIn index={4} style={{ marginTop: 12 }}>
        <Card style={{ gap: 10 }}>
          <Kicker>Connected services</Kicker>
          <Text style={{ color: colors.text, fontSize: 15.5 }}>Gmail</Text>

          {gmailConfigured === null ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : !gmailConfigured ? (
            <Text style={type.meta}>
              Not available on this server. The Gmail connection needs Google credentials on
              the backend, and the read-only scope needs Google's review before the app can
              leave testing.
            </Text>
          ) : (
            <>
              {accounts.length === 0 ? (
                <Text style={type.meta}>
                  Connect a mailbox and your companion can tell you what people have actually
                  asked you for — and reply, once you approve it.
                </Text>
              ) : (
                <View style={{ gap: 8 }}>
                  {accounts.map((account) => (
                    <View
                      key={account.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        paddingVertical: 10,
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: colors.dividerFaint,
                      }}
                    >
                      <Ionicons name="mail-outline" size={17} color={colors.textMuted} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: colors.text, fontSize: 14.5 }} numberOfLines={1}>
                          {account.email}
                        </Text>
                        <Text style={type.label}>
                          {account.sync_error
                            ? account.sync_error
                            : account.history_id
                              ? 'Synced'
                              : 'Waiting for its first sync'}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => {
                          void (async () => {
                            try {
                              await client.api.gmail.removeAccount(account.id);
                              toast.show('Mailbox disconnected');
                              await loadGmail();
                            } catch {
                              toast.show('Could not disconnect that.');
                            }
                          })();
                        }}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Disconnect ${account.email}`}
                      >
                        <Text style={{ color: colors.danger, fontSize: 13 }}>Disconnect</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <GhostButton
                  label={accounts.length ? 'Connect another' : 'Connect Gmail'}
                  onPress={() => void connectGmail()}
                  disabled={gmailBusy}
                  style={{ flex: 1, height: 44 }}
                />
                <GhostButton
                  label={accounts.length ? 'Sync now' : 'Refresh'}
                  onPress={() => void (accounts.length ? syncGmail() : loadGmail())}
                  disabled={gmailBusy}
                  style={{ flex: 1, height: 44 }}
                />
              </View>

              {!!gmailNote && <Text style={type.meta}>{gmailNote}</Text>}

              <Text style={type.label}>
                MyPro stores who wrote, the subject and Gmail's own one-line preview — never
                the body. Summaries are written on your laptop, so no email text reaches a
                model you do not run.
              </Text>
            </>
          )}
        </Card>
      </FadeIn>

      {/* Storage and sync */}
      <FadeIn index={5} style={{ marginTop: 12 }}>
        <Card style={{ gap: 8 }}>
          <Kicker>Storage and sync</Kicker>
          <Text style={{ color: colors.text, fontSize: 15.5 }}>
            {synced
              ? `${synced.withText} of ${synced.total} book${synced.total === 1 ? '' : 's'} readable here`
              : 'Checking…'}
          </Text>
          <Text style={type.meta}>
            This phone keeps no PDFs. A book becomes readable here once the device that
            imported it has extracted its text, which then syncs through your server — so
            there is nothing on this device to move between device and cloud storage, and the
            web app is where that choice is made.
          </Text>
        </Card>
      </FadeIn>

      {/* Other sections */}
      <FadeIn index={6} style={{ marginTop: 12 }}>
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
      <FadeIn index={7} style={{ marginTop: 12 }}>
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
