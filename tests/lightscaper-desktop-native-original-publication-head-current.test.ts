/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from '../desktop/lightscaper-native-photo-media-current-v1.ts';
import { consumeLightscaperNativeOriginalPublicationCurrentV1 as consumeOrdinary } from '../desktop/lightscaper-native-original-store-current-v1.ts';
import { assert, readHead, generationChunksCurrentV1 as chunks, digestCurrentV1 as digest,
	nativeOriginalGenerationFixtureCurrentV1 as fixture, GENERATION_OPTIONS_CURRENT_V1 as options } from './helpers/lightscaper-native-original-generation-fixture-current.ts';

void test('Lightscaper ordinary native asset refuses a head advanced during its genuine file authentication', options, async context => {
	await fixture(context, async f => {
	 const media = await Media.open({ appDataPath: f.appDataPath });
	 try { await f.hold(async gate => {
	  const work = f.track(media.writeAsset('ordinary-head-race', new Blob([new Uint8Array(f.bytes)]), { name: 'race.bin' }, { signal: f.signal }));
	  // Attach the rejection observer before releasing real IO; no unhandled
	  // rejection can escape while the peer completes its actual generation.
	  const outcome = work.then(value => ({ okay: true as const, value }), (error: unknown) => ({ okay: false as const, error }));
	  try {
	   await Promise.race([gate.entered, work.then(() => { throw new Error('Ordinary publication finished before the held file read.'); })]);
	   context.signal.throwIfAborted(); await f.repair(); const winner = readHead(f.db, f.binding);
	   assert.equal(winner.layout, 'generation-v1'); gate.release(); const result = await outcome;
	   assert.equal(result.okay, false, 'historical file authentication must not publish metadata against a different current head');
	   assert.equal(f.db.prepare('SELECT 1 AS present FROM native_photo_media_assets WHERE source_id=?').get('ordinary-head-race'), undefined);
	   assert.deepEqual(readHead(f.db, f.binding), winner);
	   assert.equal(digest(await f.store.readBinding(f.binding, 0, f.bytes.length, { signal: f.signal })), f.binding.contentSha256);
	  } finally { gate.release(); await Promise.allSettled([work, outcome]); }
	 }); } finally { await media.close(); }
	});
});

void test('Lightscaper returned ordinary native proof cannot substitute an older generation inside the consuming transaction', options, async context => {
	await fixture(context, async f => {
	 const admitted = { ...f.binding, storageKey: 'ordinary-before-repair' };
	 const proof = await f.store.storeBinding(admitted, chunks(f.bytes), { signal: f.signal });
	 await f.repair(); const winner = readHead(f.db, f.binding); assert.equal(winner.layout, 'generation-v1');
	 f.db.exec('BEGIN IMMEDIATE');
	 try { assert.throws(() => consumeOrdinary(proof, f.db), 'returned proof must still bind the actual current physical head'); }
	 finally { if (f.db.isTransaction) f.db.exec('ROLLBACK'); }
	 assert.deepEqual(readHead(f.db, f.binding), winner);
	 assert.equal(digest(await f.store.readBinding(f.binding, 0, f.bytes.length, { signal: f.signal })), f.binding.contentSha256);
	 const freshBinding = { ...f.binding, storageKey: 'ordinary-after-repair' };
	 const fresh = await f.store.storeBinding(freshBinding, chunks(f.bytes), { signal: f.signal });
	 f.db.exec('BEGIN IMMEDIATE');
	 try { assert.deepEqual(consumeOrdinary(fresh, f.db), freshBinding); }
	 finally { if (f.db.isTransaction) f.db.exec('ROLLBACK'); }
	});
});
