import test from 'node:test';
import assert from 'node:assert/strict';
import { allowsAudienceMeasurement, redactAnalyticsEvent } from '../src/lib/analytics.ts';

test('analytics removes query, fragment and URL credentials while preserving the public page', () => {
  assert.deepEqual(redactAnalyticsEvent({
    type: 'pageview',
    url: 'https://visitor:placeholder@todos-com-lula.vercel.app/videos/?email=example%40example.com&session=placeholder#private',
  }), { type: 'pageview', url: 'https://todos-com-lula.vercel.app/videos/' });
});

test('analytics discards malformed and non-web URLs', () => {
  for (const url of ['invalid', 'data:text/plain,private', 'file:///private']) {
    assert.equal(redactAnalyticsEvent({ type: 'pageview', url }), null);
  }
});

test('audience measurement respects browser privacy signals', () => {
  assert.equal(allowsAudienceMeasurement({}), true);
  assert.equal(allowsAudienceMeasurement({ doNotTrack: '0' }), true);
  assert.equal(allowsAudienceMeasurement({ doNotTrack: '1' }), false);
  assert.equal(allowsAudienceMeasurement({ globalPrivacyControl: true }), false);
});
