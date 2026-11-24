/**
 * Build-time additions to app.json (Expo merges this over it).
 *
 * Push — instant alerts with the app closed, e.g. "your scheduled AI task has
 * finished" — needs two pieces of deployment config, never committed:
 *
 *  - `EAS_PROJECT_ID`: the Expo project id the push token is minted for.
 *  - `GOOGLE_SERVICES_JSON`: path to the Firebase `google-services.json` that
 *    links the APK to FCM (CI writes the repository secret to a file and sets
 *    this to its path).
 *
 * With either missing the APK still builds and every scheduled reminder still
 * fires from the phone's own alarm clock; only push is off, and Settings says
 * so rather than pretending.
 */
module.exports = ({ config }) => {
  const projectId = (process.env.EAS_PROJECT_ID || '').trim();
  const googleServices = (process.env.GOOGLE_SERVICES_JSON || '').trim();
  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServices ? { googleServicesFile: googleServices } : {}),
    },
    extra: {
      ...(config.extra || {}),
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
};
