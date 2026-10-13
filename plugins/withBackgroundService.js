// Declares react-native-background-actions' service with foregroundServiceType="dataSync" (required on
// Android 14+; the library's own manifest omits it) and adds the permissions the service needs.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const SERVICE = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';

module.exports = function withBackgroundService(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.WAKE_LOCK',
  ]);
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service = (app.service || []).filter((s) => s.$['android:name'] !== SERVICE);
    app.service.push({
      $: { 'android:name': SERVICE, 'android:foregroundServiceType': 'dataSync', 'android:exported': 'false' },
    });
    return cfg;
  });
};
