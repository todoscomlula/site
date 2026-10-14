import { inject } from '@vercel/analytics';
import { allowsAudienceMeasurement, redactAnalyticsEvent, type PrivacySignals } from '../lib/analytics';

if (import.meta.env.PROD && allowsAudienceMeasurement(navigator as Navigator & PrivacySignals)) {
  inject({
    mode: 'production',
    debug: false,
    framework: 'astro',
    beforeSend: redactAnalyticsEvent,
    basePath: import.meta.env.PUBLIC_VERCEL_OBSERVABILITY_BASEPATH,
  }, import.meta.env.PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG);
}
