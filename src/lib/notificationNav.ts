import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

/** Tapping a "TryChat replied" notification opens that chat. */
export function useNotificationNavigation(ready: boolean) {
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const url = response?.notification.request.content.data?.url;
    if (!ready || typeof url !== 'string') return;
    router.push(url as never);
    Notifications.clearLastNotificationResponse();
  }, [ready, response]);
}
