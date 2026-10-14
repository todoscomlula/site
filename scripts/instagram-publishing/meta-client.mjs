import { API_VERSION, PublishingError, TARGET_ACCOUNT } from './core.mjs';

export class MetaClient {
  constructor({ accessToken, userId, version = API_VERSION, fetchImpl = fetch }) {
    if (!accessToken || !/^\d{1,40}$/.test(userId || '') || !/^v\d{1,2}\.\d{1,2}$/.test(version)) {
      throw new PublishingError('MISSING_INSTAGRAM_CONFIGURATION');
    }
    this.accessToken = accessToken;
    this.userId = userId;
    this.base = `https://graph.instagram.com/${version}/`;
    this.fetch = fetchImpl;
  }

  async request(path, { method = 'GET', query = {}, body } = {}) {
    const url = new URL(path, this.base);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let response;
    try {
      response = await this.fetch(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        ...(body && { body: JSON.stringify(body) }),
      });
    } catch { throw new PublishingError('META_REQUEST_INTERRUPTED'); }
    let data;
    try { data = await response.json(); } catch { throw new PublishingError('INVALID_META_RESPONSE', response.status); }
    // Provider messages can echo request parameters, including tokens: never expose them.
    if (!response.ok || data?.error) throw new PublishingError('META_REQUEST_FAILED', response.status, data?.error?.code);
    return data;
  }

  async verifyAccount() {
    const data = await this.request(this.userId, { query: { fields: 'username' } });
    if (data.username?.toLowerCase() !== TARGET_ACCOUNT) throw new PublishingError('WRONG_INSTAGRAM_ACCOUNT');
  }

  async quota() {
    const data = await this.request(`${this.userId}/content_publishing_limit`, { query: { fields: 'config,quota_usage' } });
    const limit = data.data?.[0];
    return { used: limit?.quota_usage, maximum: limit?.config?.quota_total };
  }

  async createContainer(candidate, caption) {
    const body = candidate.kind === 'REELS'
      ? { media_type: 'REELS', video_url: candidate.mediaUrl, share_to_feed: true, caption }
      : { image_url: candidate.mediaUrl, caption, alt_text: Array.from(candidate.post.title).slice(0, 1_000).join('') };
    const data = await this.request(`${this.userId}/media`, { method: 'POST', body });
    return data.id;
  }

  async containerStatus(containerId) {
    const data = await this.request(containerId, { query: { fields: 'status_code' } });
    return data.status_code;
  }

  async publishContainer(containerId) {
    // Intentionally one attempt: a transport failure does not prove the post failed.
    const data = await this.request(`${this.userId}/media_publish`, { method: 'POST', body: { creation_id: containerId } });
    return data.id;
  }
}
