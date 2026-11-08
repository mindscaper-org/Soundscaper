/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { nativeSessionLeaseFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-session-lease-integration-fixture-current.ts';
import { nativeScopeIntegrationFixtureCurrentV1 as scopeFixture } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';

function invoke(method: unknown, receiver: unknown, args: unknown[]): unknown {
	assert.equal(typeof method, 'function'); return Reflect.apply(method as (...values: unknown[]) => unknown, receiver, args);
}
async function refused(run: () => unknown): Promise<void> { let rejected = false; try { await run(); } catch { rejected = true; } assert.equal(rejected, true); }

void test('Native selected stop fences complete captured port families before reflecting borrowed arguments, while Original cleanup stays callable', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		const c = f.components, luts = await c.resources.cubeLutResources(), brushes = await c.resources.maskRasterResources();
		const cache = c.media.createBinaryDerivativeCache(PHOTO_PREVIEW_CACHE_PROFILE_V1);
		const issued = await c.originalTickets.transport.open(f.requests[0]!); assert.ok(issued !== null && typeof issued === 'object' && 'id' in issued && typeof issued.id === 'string');
		const id = issued.id; let traps = 0;
		const poison = new Proxy({}, { get() { traps++; throw new Error('Stopped get'); }, ownKeys() { traps++; throw new Error('Stopped ownKeys'); }, getPrototypeOf() { traps++; throw new Error('Stopped prototype'); } });
		f.lease.stop(); assert.equal(f.lease.signal.aborted, true); f.lease.stop();
		const families: ReadonlyArray<Readonly<{ owner: unknown; names: readonly string[] }>> = [
			{ owner: c.catalog, names: ['createCatalog', 'loadCatalog', 'loadPhoto', 'publishPhotos', 'publishDerivedPhotoCurrentV1', 'savePhoto', 'saveCatalog', 'readSummaryPage', 'readSnapshot', 'readQueryPage', 'readQueryPageV2',
				'rebuildQueryIndexPage', 'rebuildQueryIndexPageV2', 'loadStack', 'readStackState', 'readStackPage', 'readStackMembershipPage', 'readStackMemberPage', 'saveStack', 'dissolveStack',
				'readStackQueryPage', 'readStackQueryPageV2', 'readCullingDestinationPage', 'loadSmartCollection', 'readSmartCollectionState', 'readSmartCollectionPage',
				'readSmartCollectionSnapshotV1', 'readSmartCollectionQueryPageV1', 'readSmartCollectionStackQueryPageV1', 'saveSmartCollection', 'deleteSmartCollection', 'readSmartCollectionArchiveContextV1', 'captureSmartCollectionArchiveV1'] },
			{ owner: c.media, names: ['writeAsset', 'beginAssetWrite', 'getAssetMetadata', 'deleteAsset', 'inspectCatalogOriginalBody', 'restoreCatalogOriginalBody', 'createBinaryDerivativeCache'] },
			{ owner: c.media.catalogOriginals, names: ['retain', 'stage', 'release', 'releaseStaged', 'promote', 'readPage', 'findDigestPage'] },
			{ owner: cache, names: ['load', 'store', 'trim'] },
			{ owner: c.settings.settingsRepository, names: ['get', 'readEntry', 'put', 'delete', 'putIfAbsent', 'replaceIfCurrent', 'deleteIfCurrent', 'replaceIfCurrentAndPutIfAbsent'] },
			{ owner: c.settings, names: ['readImportIntentCurrentV1'] },
			{ owner: c.resources, names: ['cubeLutResources', 'maskRasterResources'] },
			{ owner: luts, names: ['put', 'importFile', 'verifyPhoto', 'verifyPreset', 'verifyReferencesV1'] },
			{ owner: brushes, names: ['put', 'verifyPhoto', 'verifyPreset', 'verifyReferencesV1'] },
			{ owner: luts.source, names: ['withBytes'] }, { owner: brushes.source, names: ['withBytes'] },
			{ owner: c.originals, names: ['withOriginal', 'withOriginalGroup'] },
			{ owner: c.originalTickets.transport, names: ['open', 'read', 'openGroup', 'readGroup'] },
		];
		try {
			for (const { owner, names } of families) for (const name of names) await refused(() => invoke(Reflect.get(owner as object, name), owner, [poison, poison, poison, poison]));
			await refused(() => invoke(f.lease.exclusive, f.lease, [poison, poison, poison]));
			await c.originalTickets.transport.close({ id });
			assert.equal(traps, 0, 'Every selected front door must fence before borrowed DTO/options/bytes/callback capture.');
		} finally { await c.originalTickets.transport.close({ id }); await f.lease.close(); }
	});
});

void test('Native selected lease owns one epoch role and captures its local close method and receiver before vending', { timeout: 15_000 }, async context => {
	await fixture(context, async f => {
		let traps = 0; const foreign = new Proxy({}, { get() { traps++; throw new Error('Busy close reflection'); }, ownKeys() { traps++; throw new Error('Busy ownKeys'); } });
		await refused(() => invoke(Reflect.get(f.scopes, 'openSessionLease'), f.scopes, [f.selected.scope, foreign])); assert.equal(traps, 0);
		f.local.close = async () => { assert.fail('Later replaced local close must not retarget actual retirement.'); };
		const closing = f.lease.close(); assert.equal(f.lease.close(), closing); await closing; assert.equal(f.counts().localCloses, 1);
	});
});

void test('Native selected lease refuses default/allocated scope capabilities before borrower close reflection', { timeout: 15_000 }, async context => {
	await scopeFixture(async f => {
		let traps = 0; const local = new Proxy({}, { get() { traps++; throw new Error('Not-selected close reflected'); }, ownKeys() { traps++; throw new Error('Not-selected shape reflected'); } });
		const plain = await f.scopes.openDefault(), allocated = await f.scopes.allocate('not-selected-catalog');
		for (const scope of [plain, allocated, Object.freeze({}), new Proxy(plain, {})]) await refused(() => invoke(Reflect.get(f.scopes, 'openSessionLease'), f.scopes, [scope, local]));
		assert.equal(traps, 0); context.signal.throwIfAborted();
	});
});

void test('Native selected lease registration precedes borrowed options close reentry and joins its actual registered local owner', { timeout: 15_000 }, async context => {
	await scopeFixture(async f => {
		const selected = await f.scopes.openSelected({ name: 'Reentrant selected lease' }); let closing: Promise<void> | undefined, localCloses = 0, finished = false, early = false;
		const local = { async close() { assert.equal(this, local); localCloses++; } };
		const options = new Proxy({}, { ownKeys() {
			closing = f.scopes.close(); void closing.then(() => { if (!finished) early = true; }); throw new Error('Borrowed lease options refused.');
		} });
		const work = Promise.resolve(invoke(Reflect.get(f.scopes, 'openSessionLease'), f.scopes, [selected.scope, local, options]));
		await work.then(() => { finished = true; assert.fail('Options capture must refuse.'); }, () => { finished = true; });
		assert.ok(closing); await closing; assert.equal(early, false); assert.equal(localCloses, 1); context.signal.throwIfAborted();
	});
});
