import assert from 'node:assert/strict';
import { differenceHash, hammingDistance, sameVideo, assignContentGroups, relativeAgeDays } from './storiesig-video-fingerprint.mjs';

const ramp = Buffer.from(Array.from({ length: 72 }, (_, index) => index % 9));
assert.equal(differenceHash(ramp), 'ffffffffffffffff');
assert.equal(differenceHash(Buffer.alloc(72)), '0000000000000000');
assert.equal(hammingDistance('ffffffffffffffff', '0000000000000000'), 64);
assert.throws(() => differenceHash(Buffer.alloc(71)));

const video = { version: 1, durationSeconds: 50, frames: ['1111111111111111', '2222222222222222', '3333333333333333', '4444444444444444'] };
const encodedAgain = { ...video, durationSeconds: 49.91, frames: video.frames.map(frame => (BigInt(`0x${frame}`) ^ 1n).toString(16).padStart(16, '0')) };
assert.equal(sameVideo(video, encodedAgain), true);
assert.equal(sameVideo(video, { ...encodedAgain, durationSeconds: 60 }), false);
assert.equal(sameVideo(video, { ...video, frames: ['eeeeeeeeeeeeeeee', 'dddddddddddddddd', 'cccccccccccccccc', 'bbbbbbbbbbbbbbbb'] }, 'Legenda igual e longa para verificar a diferença', 'Legenda igual e longa para verificar a diferença'), false);
const publishedMontage = { version: 1, durationSeconds: 15.581995, frames: ['019809031ec42303', '6ad86771f5d9f369', 'dcd8e16232981695', '00d240c105445991'] };
const originalMontage = { version: 1, durationSeconds: 15.693832, frames: ['019a09071ec42303', '62f07575f25cd16d', 'bcfac4c56431e422', '00d24041154c4819'] };
assert.equal(sameVideo(originalMontage, publishedMontage), false);
assert.equal(sameVideo(publishedMontage, { ...publishedMontage, frames: publishedMontage.frames.map(frame => (BigInt(`0x${frame}`) ^ 1n).toString(16).padStart(16, '0')) }), true);
const inputRecords = [
  { id: 'newer', kind: 'video', observedAt: '2026-10-14T17:00:00Z' },
  { id: 'oldest', kind: 'video', observedAt: '2026-10-14T05:00:00Z' },
  { id: 'different', kind: 'video', observedAt: '2026-10-14T06:00:00Z' },
  { id: 'missing-fingerprint', kind: 'video' },
  { id: 'image', kind: 'image' },
];
const groups = assignContentGroups(inputRecords, { newer: encodedAgain, oldest: video, different: { ...video, durationSeconds: 60 } });
assert.deepEqual(groups.map(record => record.contentGroupId), ['oldest', 'oldest', 'different', 'missing-fingerprint', undefined]);
assert.equal(inputRecords[0].contentGroupId, undefined);
assert.deepEqual(assignContentGroups([...inputRecords].reverse(), { newer: encodedAgain, oldest: video }).filter(record => ['newer', 'oldest'].includes(record.id)).map(record => record.contentGroupId), ['oldest', 'oldest']);
const chainRecords = ['a', 'b', 'c'].map((id, index) => ({ id, kind: 'video', observedAt: `2026-10-14T0${index}:00:00Z` }));
const chainFingerprint = bits => ({ ...video, frames: Array(4).fill(bits) });
const chainCache = { a: chainFingerprint('0000000000000000'), b: chainFingerprint('0000000000000007'), c: chainFingerprint('000000000000003f') };
assert.equal(sameVideo(chainCache.a, chainCache.b), true);
assert.equal(sameVideo(chainCache.b, chainCache.c), true);
assert.equal(sameVideo(chainCache.a, chainCache.c), false);
assert.deepEqual(assignContentGroups(chainRecords, chainCache).map(record => record.contentGroupId), ['a', 'a', 'c']);
assert.equal(relativeAgeDays('6 hours ago'), 0.25);
assert.equal(relativeAgeDays('1 days ago'), 1);
assert.equal(relativeAgeDays('2 weeks ago'), 14);
assert.equal(relativeAgeDays(null), null);
console.log('Comparação de conteúdo: quadros finais, duração, idade e grupos estáveis verificados.');
