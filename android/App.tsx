import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { isApiConfigured, isAgentConfigured } from '@mypro/shared';
import { client } from './src/lib/client';

/**
 * Phase 2 scaffold. This screen's only job is to prove the Android app boots
 * on the shared core: it reads the resolved config straight out of
 * `client.env` (the same `@mypro/shared` instance the web app uses) and shows
 * what is wired. Real auth (Phase 3) and the assistant chat (Phase 4) land on
 * top of this exact client.
 */
export default function App() {
  const { env } = client;
  const apiReady = isApiConfigured(env);
  const agentReady = isAgentConfigured(env);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>MyPro</Text>
        <Text style={styles.subtitle}>Personal companion — Android</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Shared core</Text>
          <Text style={styles.ok}>✓ @mypro/shared loaded</Text>
          <Text style={styles.muted}>
            Same types, API client, auth and agent discovery as the web app.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Backends</Text>
          <Row label="Core API (render)" ready={apiReady} />
          <Row label="Assistant (laptop agent)" ready={agentReady} />
          {!apiReady && (
            <Text style={styles.muted}>
              Set EXPO_PUBLIC_API_URL (your Render URL) to connect — that's the
              only backend the app needs.
            </Text>
          )}
        </View>

        <Text style={styles.footer}>
          Next: sign-in (Phase 3) and the assistant chat (Phase 4).
        </Text>
      </ScrollView>
    </View>
  );
}

function Row({ label, ready }: { label: string; ready: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={ready ? styles.ok : styles.off}>{ready ? '●' : '○'}</Text>
      <Text style={styles.rowLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  content: { padding: 24, paddingTop: 72, gap: 20 },
  brand: { color: '#ffffff', fontSize: 40, fontWeight: '700', letterSpacing: -1 },
  subtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 15, marginTop: -8 },
  card: {
    backgroundColor: '#0e0e0e',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 8,
  },
  cardTitle: { color: '#ffffff', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 15 },
  ok: { color: '#ffffff', fontSize: 15 },
  off: { color: 'rgba(255,255,255,0.35)', fontSize: 15 },
  muted: { color: 'rgba(255,255,255,0.45)', fontSize: 13, lineHeight: 18 },
  footer: { color: 'rgba(255,255,255,0.35)', fontSize: 13, marginTop: 8 },
});
