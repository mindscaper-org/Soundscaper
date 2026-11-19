/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { fixture, test, deferred, requirePhysicalReadCurrentV1 as physical, repairReaderBodyCurrentV1 as repair,
	withRepairReaderPeerCurrentV1 as withPeer } from './helpers/lightscaper-native-original-repair-reader-fixture-current.ts';
import { observeNativeWriterFileWritesCurrentV1 as observeWrites } from './helpers/lightscaper-native-media-writer-integration-fixture-current.ts';

for (const peerOwner of [false, true]) void test(`Lightscaper native repair books ${peerOwner ? 'peer' : 'same-owner'} namespace admission before borrowed binding reflection`, { timeout: 15_000 }, async context => {
	await fixture(async f => {
		await physical(f);
		await withPeer(f, async peer => {
			const entered = deferred(), release = deferred(); let held = false;
			await observeWrites(f.appDataPath, async () => { if (!held) { held = true; entered.resolve(); await release.promise; } }, async () => {
				const first = repair(f, f.request, null, f.media, context.signal); void first.catch(() => undefined);
				let second: Promise<unknown> | undefined, reflections = 0;
				try {
					await Promise.race([entered.promise, first.then(() => { throw new Error('Repair skipped its actual FileHandle write.'); }, (error: unknown) => { throw error; })]);
					context.signal.throwIfAborted();
					const original = f.request.original, target = peerOwner ? peer : f.media;
					const binding = new Proxy({ catalogId: f.request.catalogId, importId: null, photoId: f.request.photoId, assetId: original.storageKey,
						sourceId: original.id, sha256: original.contentSha256, size: original.byteLength, name: original.name, mimeType: original.mimeType },
					{ ownKeys() { reflections++; throw new Error('Busy repair inspected borrowed binding.'); } });
					const method: unknown = Reflect.get(target, 'restoreCatalogOriginalBody'); assert.equal(typeof method, 'function');
					second = Reflect.apply(method as (...args: unknown[]) => Promise<unknown>, target, [binding, new Blob([f.entry.bytes]), { signal: context.signal }]);
					void second.catch(() => undefined);
					// Public ordering may still wait for its earlier accepted work; the
					// admission itself must refuse before any borrowed record trap.
					assert.equal(reflections, 0); release.resolve(); await first; await assert.rejects(second, /busy|pending|capacity/iu);
				} finally { release.resolve(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
			});
			await repair(f, f.request, null, f.media, context.signal); context.signal.throwIfAborted();
		});
	}, { length: 16_384 });
});
