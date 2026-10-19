import { readFile } from 'node:fs/promises';
import { emptyState, PublishingError, STATE_BRANCH, MANUAL_STATE_BRANCH, STATE_REPOSITORY, validateState } from './core.mjs';
import { scanPublicState } from './secret-scan.mjs';

export class LocalReadOnlyState {
  constructor(path = '.cache/instagram-publishing/state.json') { this.path = path; }
  async load() {
    try { return validateState(JSON.parse(await readFile(this.path, 'utf8'))); }
    catch (error) {
      if (error.code === 'ENOENT') return emptyState();
      throw new PublishingError('INVALID_LOCAL_STATE');
    }
  }
  async save() { throw new PublishingError('LOCAL_STATE_IS_READ_ONLY'); }
}

export class GithubStateStore {
  constructor({ token, repository = STATE_REPOSITORY, branch = STATE_BRANCH, fetchImpl = fetch, scan = scanPublicState }) {
    if (!token || repository !== STATE_REPOSITORY || ![STATE_BRANCH,MANUAL_STATE_BRANCH].includes(branch)) throw new PublishingError('MISSING_GITHUB_STATE_CONFIGURATION');
    this.branch = branch;
    this.token = token;
    this.fetch = fetchImpl;
    this.base = `https://api.github.com/repos/${STATE_REPOSITORY}/`;
    this.sha = null;
    this.scan = scan;
  }

  async request(path, { method = 'GET', body, allowMissing = false } = {}) {
    let response;
    try {
      response = await this.fetch(new URL(path, this.base), {
        method, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        ...(body && { body: JSON.stringify(body) }),
      });
    } catch { throw new PublishingError('GITHUB_STATE_REQUEST_INTERRUPTED'); }
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new PublishingError(response.status === 409 || response.status === 422 ? 'GITHUB_STATE_CONFLICT' : 'GITHUB_STATE_REQUEST_FAILED', response.status);
    try { return await response.json(); } catch { throw new PublishingError('INVALID_GITHUB_STATE_RESPONSE'); }
  }

  async load({ create = false } = {}) {
    const file = await this.request(`contents/state.json?ref=${this.branch}`, { allowMissing: true });
    if (!file) {
      this.sha = null;
      if (create) { await this.initialize(); return this.load(); }
      return emptyState();
    }
    if (file.encoding !== 'base64' || typeof file.sha !== 'string') throw new PublishingError('INVALID_GITHUB_STATE_RESPONSE');
    let state;
    try { state = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')); }
    catch { throw new PublishingError('INVALID_PUBLIC_STATE'); }
    this.sha = file.sha;
    return validateState(state);
  }

  async initialize() {
    const content = JSON.stringify(emptyState(), null, 2) + '\n';
    const configuration = JSON.stringify({ $schema: 'https://openapi.vercel.sh/vercel.json', git: { deploymentEnabled: false } }, null, 2) + '\n';
    await this.scan(content, { 'vercel.json': configuration });
    const blob = await this.request('git/blobs', { method: 'POST', body: { content, encoding: 'utf-8' } });
    const configBlob = await this.request('git/blobs', { method: 'POST', body: { content: configuration, encoding: 'utf-8' } });
    const tree = await this.request('git/trees', { method: 'POST', body: { tree: [
      { path: 'state.json', mode: '100644', type: 'blob', sha: blob.sha },
      { path: 'vercel.json', mode: '100644', type: 'blob', sha: configBlob.sha },
    ] } });
    const commit = await this.request('git/commits', { method: 'POST', body: { message: 'Initialize sanitized Instagram state [skip ci]', tree: tree.sha, parents: [] } });
    await this.request('git/refs', { method: 'POST', body: { ref: `refs/heads/${this.branch}`, sha: commit.sha } });
  }

  async save(state) {
    if (!this.sha) throw new PublishingError('GITHUB_STATE_NOT_INITIALIZED');
    const serialized = JSON.stringify(validateState(state), null, 2) + '\n';
    await this.scan(serialized);
    const content = Buffer.from(serialized).toString('base64');
    const result = await this.request('contents/state.json', {
      method: 'PUT', body: { branch: this.branch, sha: this.sha, message: 'Checkpoint sanitized Instagram publishing state [skip ci]', content },
    });
    if (typeof result.content?.sha !== 'string') throw new PublishingError('INVALID_GITHUB_STATE_RESPONSE');
    this.sha = result.content.sha;
  }
}
