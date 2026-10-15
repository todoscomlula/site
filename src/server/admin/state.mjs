import seedSources from '../../data/sources.json' with { type: 'json' };
import { AdminError, digest } from './auth.mjs';

export const MAX_PENDING_BYTES = 512 * 1024 * 1024;
export const MAX_CANDIDATES = 200;
export const validUsername = (value) => typeof value === 'string' && /^(?!\.+$)[a-z0-9_.]{1,30}$/.test(value);
export const validId = (value) => typeof value === 'string' && /^storiesig-[a-z0-9_.]{1,30}-[a-f0-9]{12}$/.test(value);
export const validDate = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
export const statuses = ['pending', 'approved', 'generating', 'ready', 'publishing', 'awaiting_instagram', 'published', 'rejected', 'error'];
export function cleanText(value, maximum = 4000) {
  return Array.from(String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()).slice(0, maximum).join('');
}
export function normalizeUsername(value) {
  let username = String(value || '').trim().toLowerCase();
  if (/^https?:\/\//.test(username)) {
    let url; try { url = new URL(username); } catch { throw new AdminError('INVALID_USERNAME'); }
    if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash) throw new AdminError('INVALID_USERNAME');
    const match = url.pathname.match(/^\/([a-z0-9_.]{1,30})(?:\/reels)?\/?$/);
    if (!match) throw new AdminError('INVALID_USERNAME'); username = match[1];
  }
  username = username.replace(/^@/, '');
  if (!validUsername(username) || ['p', 'reel', 'reels', 'stories', 'explore', 'accounts'].includes(username)) throw new AdminError('INVALID_USERNAME');
  return username;
}
export function emptyAdminState() {
  return { version: 1, sources: seedSources.map(source => ({ username: source.username, name: source.name, enabled: true, autoCollect: false, requestedAt: null, lastCollectedAt: null, nextCollectAt: null, lastStatus: 'idle', lastError: null })), candidates: [], activity: [], worker: { lease: null, lastRunAt: null, lastError: null } };
}
export function addActivity(state, kind, message, now = new Date().toISOString()) {
  state.activity.unshift({ kind, message: cleanText(message, 200), at: now });
  state.activity = state.activity.slice(0, 60);
}
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const nullableDate = (value) => value === null || validDate(value);
const errorCode = (value) => value === null || (typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value));
const string = (value, max) => typeof value === 'string' && Array.from(value).length <= max;
export function validateCaption(value) {
  if (!exact(value, ['title', 'text', 'hashtags', 'model', 'generatedAt', 'skillRevision']) || !string(value.title, 120) || value.title.length < 3
    || !string(value.text, 1400) || value.text.length < 15 || !Array.isArray(value.hashtags) || value.hashtags.length < 3 || value.hashtags.length > 5
    || new Set(value.hashtags).size !== value.hashtags.length || !value.hashtags.every(tag => typeof tag === 'string' && /^[\p{L}\p{N}_]{2,50}$/u.test(tag))
    || !string(value.model, 80) || !validDate(value.generatedAt) || !/^[a-f0-9]{40}$/.test(value.skillRevision)) throw new AdminError('INVALID_AI_CAPTION', 502);
  return value;
}
function validMedia(value, id, extension) {
  return exact(value, ['path', 'sha256', 'bytes', 'width', 'height']) && typeof value.sha256==='string' && value.path === `queue/media/${id}/${value.sha256.slice(0,12)}.${extension}`
    && /^[a-f0-9]{64}$/.test(value.sha256) && Number.isInteger(value.bytes) && value.bytes > 0 && value.bytes <= 90 * 1024 * 1024
    && Number.isInteger(value.width) && value.width > 0 && value.width <= 8192 && Number.isInteger(value.height) && value.height > 0 && value.height <= 8192;
}
export function validateAdminState(state) {
  if (!exact(state, ['version', 'sources', 'candidates', 'activity', 'worker']) || state.version !== 1 || !Array.isArray(state.sources) || state.sources.length > 100
    || !Array.isArray(state.candidates) || state.candidates.length > MAX_CANDIDATES || !Array.isArray(state.activity) || state.activity.length > 60
    || !exact(state.worker, ['lease', 'lastRunAt', 'lastError']) || !nullableDate(state.worker.lastRunAt) || !errorCode(state.worker.lastError)) throw new AdminError('INVALID_ADMIN_STATE', 503);
  const usernames = new Set(); const ids = new Set();
  for (const source of state.sources) {
    if (!exact(source, ['username', 'name', 'enabled', 'autoCollect', 'requestedAt', 'lastCollectedAt', 'nextCollectAt', 'lastStatus', 'lastError']) || !validUsername(source.username) || usernames.has(source.username)
      || !string(source.name, 80) || typeof source.enabled !== 'boolean' || typeof source.autoCollect !== 'boolean' || !nullableDate(source.requestedAt) || !nullableDate(source.lastCollectedAt) || !nullableDate(source.nextCollectAt)
      || !['idle', 'queued', 'collecting', 'success', 'error'].includes(source.lastStatus) || !errorCode(source.lastError)) throw new AdminError('INVALID_ADMIN_STATE', 503);
    usernames.add(source.username);
  }
  for (const item of state.candidates) {
    if (!exact(item, ['id', 'source', 'sourceName', 'sourceUrl', 'permalink', 'originalTitle', 'originalCaption', 'notes', 'observedAt', 'contentGroupId', 'media', 'mediaRemoved', 'mentionProfiles', 'status', 'approvedAt', 'caption', 'lastError', 'sitePublishedAt', 'publishedAt'])
      || !validId(item.id) || ids.has(item.id) || !validUsername(item.source) || !string(item.sourceName,80) || item.sourceUrl !== `https://www.instagram.com/${item.source}/reels/`
      || !(item.permalink === null || /^https:\/\/www\.instagram\.com\/(p|reels?)\/[A-Za-z0-9_-]+\/$/.test(item.permalink)) || !string(item.originalTitle, 120)
      || !string(item.originalCaption, 4000) || !string(item.notes, 2500) || !validDate(item.observedAt) || !validId(item.contentGroupId)
      || !exact(item.media, ['video', 'poster']) || !validMedia(item.media.video,item.id,'mp4') || !validMedia(item.media.poster,item.id,'jpg') || typeof item.mediaRemoved!=='boolean' || !statuses.includes(item.status)
      || !Array.isArray(item.mentionProfiles) || ![0,5].includes(item.mentionProfiles.length) || new Set(item.mentionProfiles).size!==item.mentionProfiles.length || !item.mentionProfiles.every(value=>validUsername(value)&&value!=='boraaalula2026')
      || !nullableDate(item.approvedAt) || !nullableDate(item.sitePublishedAt) || !nullableDate(item.publishedAt) || !errorCode(item.lastError)) throw new AdminError('INVALID_ADMIN_STATE', 503);
    if (item.caption !== null) validateCaption(item.caption);
    if (['approved', 'generating', 'ready', 'publishing', 'awaiting_instagram', 'published'].includes(item.status) && (!validDate(item.approvedAt)||item.mentionProfiles.length!==5)) throw new AdminError('INVALID_ADMIN_STATE', 503);
    if (['ready', 'publishing', 'awaiting_instagram', 'published'].includes(item.status) && item.caption === null) throw new AdminError('INVALID_ADMIN_STATE', 503);
    ids.add(item.id);
  }
  if (state.worker.lease !== null && (!exact(state.worker.lease, ['owner', 'expiresAt']) || !/^[a-f0-9-]{36}$/.test(state.worker.lease.owner) || !validDate(state.worker.lease.expiresAt))) throw new AdminError('INVALID_ADMIN_STATE', 503);
  if (!state.activity.every(item => exact(item,['kind','message','at']) && /^[a-z_]{1,40}$/.test(item.kind) && string(item.message,200) && validDate(item.at))) throw new AdminError('INVALID_ADMIN_STATE',503);
  return state;
}
export function pendingBytes(state) {
  return state.candidates.filter(item => !['published','rejected'].includes(item.status)).reduce((sum,item)=>sum+item.media.video.bytes+item.media.poster.bytes,0);
}
export function selectMentions(sources, item) {
  const eligible = sources.filter(source=>source.enabled && source.username!=='boraaalula2026').map(source=>source.username);
  if(eligible.length<5)throw new AdminError('NEED_FIVE_ACTIVE_PROFILES',422);
  const offset=parseInt(digest(item.id).slice(0,8),16)%eligible.length;
  const ordered=[...eligible.slice(offset),...eligible.slice(0,offset)];
  const first=eligible.includes(item.source)?[item.source]:[];
  return [...new Set([...first,...ordered])].slice(0,5);
}
