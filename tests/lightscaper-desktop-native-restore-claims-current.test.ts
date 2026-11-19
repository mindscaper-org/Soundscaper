/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { fixture, test, begin, openComponent, inspect, Media, Catalog, deferred, remainsPending } from './helpers/lightscaper-native-restore-claim-fixture-current.ts';

void test('Native restore candidate claims belong to an actual fresh registry allocation and grant no ordinary scope', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const candidate = await begin(f.scopes), row = (await f.scopes.readAllocationPage()).allocations[0];
		assert.ok(row); assert.equal(row.state, 'created'); assert.deepEqual(row.allocation, candidate.allocation);
		assert.equal(Object.isFrozen(candidate), true); assert.equal(Object.isFrozen(candidate.catalogClaim), true); assert.deepEqual(Object.keys(candidate.catalogClaim), []);
		assert.throws(() => f.scopes.describe(candidate)); await assert.rejects(f.scopes.resume(candidate.allocation.namespaceToken));
		let actualPath = '';
		await openComponent(candidate.catalogClaim, 'catalog', async binding => {
			assert.deepEqual(Object.keys(binding), ['allocation', 'appDataPath', 'signal', 'assertCurrent']);
			assert.deepEqual(binding.allocation, candidate.allocation); binding.assertCurrent(); actualPath = binding.appDataPath;
			assert.deepEqual(await readdir(actualPath), []); return await Catalog.open({ appDataPath: actualPath });
		});
		assert.ok(actualPath.includes(candidate.allocation.namespaceToken));
		const proof = await inspect(candidate); assert.throws(() => proof.assertRetired()); await candidate.close(); proof.assertRetired(); proof.assertCurrent();
	});
});
void test('Native restore claims refuse copied Proxy purpose-mismatched and replayed inputs before invoking borrowed factories', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const candidate = await begin(f.scopes); let calls = 0;
		const open = async (binding: Readonly<{ appDataPath: string }>) => { calls++; return await Media.open({ appDataPath: binding.appDataPath }); };
		await assert.rejects(openComponent({}, 'media', open)); await assert.rejects(openComponent(new Proxy(candidate.mediaClaim, {}), 'media', open));
		await assert.rejects(openComponent(candidate.catalogClaim, 'media', open)); assert.equal(calls, 0);
		await openComponent(candidate.mediaClaim, 'media', open); assert.equal(calls, 1);
		await assert.rejects(openComponent(candidate.mediaClaim, 'media', open)); assert.equal(calls, 1); await candidate.close();
	});
});
void test('Native candidate close joins a held actual component constructor and does not publish its late owner', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const candidate = await begin(f.scopes), entered = deferred(), release = deferred();
		const work = openComponent(candidate.mediaClaim, 'media', async binding => {
			entered.resolve(); await release.promise; return await Media.open({ appDataPath: binding.appDataPath });
		}); void work.catch(() => undefined); let closing: Promise<void> | undefined;
		try { await entered.promise; closing = candidate.close(); assert.equal(candidate.close(), closing); assert.equal(await remainsPending(closing), true); }
		finally { release.resolve(); await Promise.allSettled([work, ...(closing ? [closing] : [])]); }
		await assert.rejects(work); await closing; (await inspect(candidate)).assertRetired();
	});
});
void test('Native candidate captures actual child retirement before caller replaces its close method', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const candidate = await begin(f.scopes), media = await openComponent(candidate.mediaClaim, 'media', binding => Media.open({ appDataPath: binding.appDataPath }));
		const actual = media.close, previous = Object.getOwnPropertyDescriptor(media, 'close'); let replacements = 0;
		Object.defineProperty(media, 'close', { configurable: true, value: async (): Promise<void> => { replacements++; } });
		try { await candidate.close(); assert.equal(replacements, 0); await assert.rejects(media.getAssetMetadata('closed-probe')); }
		finally { if (previous) Object.defineProperty(media, 'close', previous); else Reflect.deleteProperty(media, 'close'); await Reflect.apply(actual, media, []); }
	});
});
void test('Native candidate constructor failures preserve opaque reason after actual opening cleanup and join role close', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const candidate = await begin(f.scopes), reason = Symbol('exact native constructor failure');
		let failed = false;
		await openComponent(candidate.mediaClaim, 'media', async binding => {
			const owner = await Media.open({ appDataPath: binding.appDataPath }); await owner.close(); throw reason;
		}).then(() => assert.fail('Constructor must fail.'), (error: unknown) => { failed = true; assert.equal(error, reason); });
		assert.equal(failed, true); await candidate.close(); (await inspect(candidate)).assertRetired();
	});
});
void test('Native restore role stays exclusive after close until explicit joined role retirement', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const candidate = await begin(f.scopes); await candidate.close(); let reflected = 0;
		const options = new Proxy({}, { ownKeys() { reflected++; return []; } });
		await assert.rejects(begin(f.scopes, 'second-catalog', options)); assert.equal(reflected, 0);
		await assert.rejects(f.scopes.resume(candidate.allocation.namespaceToken));
		const proof = await inspect(candidate); proof.assertRetired(); proof.assertCurrent();
		candidate.retireRole('unpublished'); assert.throws(() => proof.assertCurrent());
		const next = await begin(f.scopes, 'second-catalog'); assert.notEqual(next.allocation.namespaceToken, candidate.allocation.namespaceToken); await next.close();
	});
});
