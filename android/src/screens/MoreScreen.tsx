import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { client } from '../lib/client';
import { ARM_WINDOW_HOURS, armUpcoming, registerForPush } from '../lib/notifications';
import { colors, shared } from '../theme';

type Destination = 'health' | 'knowledge';

/**
 * The drawer the five tabs could not hold — Phase 8.3.
 *
 * It also carries the only place the clock is visible to the user. Phase 11
 * means a brief arrives with this laptop shut and the server asleep, which is
 * invisible when it works; saying how many notifications are armed is how you
 * find out it has stopped before you miss something.
 */
export function MoreScreen({
  onOpen,
  onSignOut,
}: {
  onOpen: (destination: Destination) => void;
  onSignOut: () => void;
}) {
  const [armed, setArmed] = useState<number | null | undefined>(undefined);
  const [pushNote, setPushNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void armUpcoming().then((count) => {
      if (active) setArmed(count);
    });
    void registerForPush().then((result) => {
      if (active && !result.ok) setPushNote(result.reason ?? null);
    });
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
      contentContainerStyle={{ padding: 20, paddingTop: 56, paddingBottom: 40, gap: 18 }}
    >
      <Text style={shared.title}>More</Text>

      <Pressable style={[shared.card, { gap: 4 }]} onPress={() => onOpen('knowledge')}>
        <Text style={{ color: colors.text, fontSize: 15.5 }}>My Knowledge</Text>
        <Text style={shared.muted}>Highlights, notes and questions from everything you read</Text>
      </Pressable>

      <Pressable style={[shared.card, { gap: 4 }]} onPress={() => onOpen('health')}>
        <Text style={{ color: colors.text, fontSize: 15.5 }}>Health</Text>
        <Text style={shared.muted}>Records, read-only on the phone</Text>
      </Pressable>

      <View style={[shared.card, { gap: 6 }]}>
        <Text style={{ color: colors.text, fontSize: 15.5 }}>Notifications</Text>
        <Text style={shared.muted}>
          {armed === undefined
            ? 'Checking…'
            : armed === null
              ? 'Not armed — allow notifications, and open the app once with a connection.'
              : armed === 0
                ? `Nothing due in the next ${ARM_WINDOW_HOURS} hours.`
                : `${armed} reminder${armed === 1 ? '' : 's'} armed for the next ${ARM_WINDOW_HOURS} hours.`}
        </Text>
        <Text style={{ color: colors.textFaint, fontSize: 11.5, lineHeight: 17 }}>
          This phone fires them itself, so a brief still arrives with your laptop shut and the
          server asleep. It re-arms every time you open the app.
        </Text>
        {pushNote && (
          <Text style={{ color: colors.textFaint, fontSize: 11.5, lineHeight: 17 }}>
            Push (for things nobody could schedule in advance) is not active: {pushNote}
          </Text>
        )}
      </View>

      <Pressable style={shared.ghostButton} onPress={() => void signOut()}>
        <Text style={shared.ghostLabel}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
