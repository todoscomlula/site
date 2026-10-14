import type { BeforeSendEvent } from '@vercel/analytics';

export type PrivacySignals = {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
};

export function allowsAudienceMeasurement(signals: PrivacySignals) {
  return signals.doNotTrack !== '1' && signals.globalPrivacyControl !== true;
}

export function redactAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    // Measure the page, without query parameters, fragments or URL credentials.
    return { ...event, url: `${url.origin}${url.pathname}` };
  } catch {
    return null;
  }
}
