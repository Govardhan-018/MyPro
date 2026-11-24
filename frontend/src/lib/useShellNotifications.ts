/**
 * Where notifications stand on the phone, as the native shell reports it.
 *
 * Only meaningful inside the Android shell: the web cannot read Android's
 * notification permission, so it asks the shell (`notification-status`) and
 * listens for the answer. Re-asked whenever the app returns to the foreground,
 * so coming back from Android's settings page shows the new state at once.
 */
import { useCallback, useEffect, useState } from 'react';
import { inShell, onShellEvent, postToShell, type ShellNotificationStatus } from './shell';

export interface ShellNotificationsState {
  status: ShellNotificationStatus | null;
  /** The last test notification's outcome, phrased for a person. */
  testNote: string | null;
  sendTest: () => void;
  /** Ask for permission again, or open Android's settings for MyPro. */
  fix: () => void;
}

export function useShellNotifications(enabled: boolean): ShellNotificationsState {
  const [status, setStatus] = useState<ShellNotificationStatus | null>(null);
  const [testNote, setTestNote] = useState<string | null>(null);

  useEffect(() => {
    if (!inShell || !enabled) return;
    const off = onShellEvent((event) => {
      if (event.type === 'notification-status') setStatus(event.status);
      if (event.type === 'test-notification') {
        setTestNote(
          event.result.ok
            ? 'Sent — it should appear in a couple of seconds.'
            : (event.result.reason ?? 'Android did not accept the notification.'),
        );
      }
    });
    postToShell({ type: 'notification-status' });
    const onVisible = () => {
      if (document.visibilityState === 'visible') postToShell({ type: 'notification-status' });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  const sendTest = useCallback(() => {
    setTestNote('Sending…');
    postToShell({ type: 'test-notification' });
  }, []);
  const fix = useCallback(() => postToShell({ type: 'fix-notifications' }), []);

  return { status, testNote, sendTest, fix };
}
