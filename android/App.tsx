import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  DMSans_400Regular, DMSans_500Medium, DMSans_700Bold, useFonts,
} from '@expo-google-fonts/dm-sans';
import { ShellApp } from './src/ShellApp';
import { NativeApp } from './src/NativeApp';
import { ThemeProvider, shared } from './src/theme';
import { ToastProvider } from './src/components/ui';
import { shellEnabled } from './src/lib/shell';

/**
 * The Android entrypoint. Since the Android upgrade the phone is a thin native
 * shell around the deployed web app (`docs/ANDROID_UPGRADE.md`), so `ShellApp`
 * is the default. The hand-maintained native screens stay one release behind
 * the `EXPO_PUBLIC_SHELL=native` flag until the shell is proven on a real
 * device, then they are deleted.
 *
 * Only the native path needs the web app's typeface and the theme/toast
 * providers; the shell renders the web app's own CSS, so it skips all of that
 * and paints immediately.
 */
export default function App() {
  if (shellEnabled()) return <ShellApp />;
  return <NativeRoot />;
}

/** The legacy native UI, with the font gate and providers it depends on. */
function NativeRoot() {
  // DM Sans is the web app's typeface, so the phone waits for it rather than
  // painting a frame in Roboto and snapping. The faces are bundled, not
  // fetched, so this resolves on the first tick.
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={[shared.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <ThemeProvider>
      <ToastProvider>
        <NativeApp />
      </ToastProvider>
    </ThemeProvider>
  );
}
