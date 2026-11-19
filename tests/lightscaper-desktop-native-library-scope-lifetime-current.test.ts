/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { nativeWriterInputCurrentV1 as input } from './helpers/lightscaper-native-media-writer-integration-fixture-current.ts';
import { nativeScopeIntegrationFixtureCurrentV1 as fixture, scopeResourceBundleCurrentV1 as bundle,
	installScopeResourceBundleCurrentV1 as install, holdScopeNativeFileWriteCurrentV1 as hold,
	SCOPE_CATALOG_CURRENT_V1 as CATALOG } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';

// No caller signal is supplied in these cases. The only cancellation source
// is the actual owning resource Close; require its native default AbortError.
async function expectResourceCloseAbort(work: Promise<unknown>): Promise<void> {
	let rejected = false;
	try { await work; } catch (error) {
		rejected = true; assert.ok(error instanceof DOMException); assert.equal(error.name, 'AbortError'); assert.equal(error.code, 20);
	}
	assert.equal(rejected, true, 'Resource Close must withhold the late read result after joining its callback.');
}

test('Lightscaper parent scope Close joins held real stream write and borrowed resource consumer before releasing all child owners', async () => {
	await fixture(async f => {
		const scope = await f.scopes.allocate(CATALOG), allocation = f.scopes.describe(scope); assert.ok(allocation);
		const components = await f.scopes.openComponents(scope), resource = await bundle(61), value = input(851, 4096);
		await install(components.resources, resource); const luts = await components.resources.cubeLutResources();
		const entered = deferred<void>(), release = deferred<void>();
		const consuming = luts.source.withBytes(resource.lut.reference, async bytes => { assert.deepEqual(bytes, resource.lut.bytes); entered.resolve(); await release.promise; assert.deepEqual(bytes, resource.lut.bytes); });
		void consuming.catch(() => undefined); await entered.promise;
		const writer = await components.media.beginAssetWrite(value.original.storageKey, value.metadata, value.options);
		let closing: Promise<void> | undefined;
		try {
			await hold(f.directory, async control => {
				const writing = writer.write(value.bytes), outcome = writing.then(() => true, () => false);
				try {
					await Promise.race([control.entered, writing.then(() => { assert.fail('No actual held stream write.'); })]);
					closing = f.scopes.close(); assert.equal(f.scopes.close(), closing); assert.equal(await remainsPending(closing), true);
					control.release(); assert.equal(await outcome, false); assert.equal(await remainsPending(closing), true);
					release.resolve(); await expectResourceCloseAbort(consuming); await closing;
				} finally { control.release(); release.resolve(); await writing.catch(() => undefined); await consuming.catch(() => undefined); await closing; }
			});
		} finally { release.resolve(); await consuming.catch(() => undefined); await closing; }
		const reopened = await f.reopen(), restored = await reopened.openComponents(await reopened.resume(allocation.namespaceToken));
		assert.equal(await restored.media.getAssetMetadata(value.original.storageKey), null);
		const restoredLuts = await restored.resources.cubeLutResources(); await restoredLuts.source.withBytes(resource.lut.reference, bytes => { assert.deepEqual(bytes, resource.lut.bytes); });
	});
});

test('Lightscaper scope allocation options Proxy Close reentry drains accepted capture before parent retirement', async () => {
	await fixture(async f => {
		let closing: Promise<void> | undefined, finished = false, closedFirst = false;
		const options = new Proxy({}, { ownKeys() { closing = f.scopes.close(); void closing.then(() => { if (!finished) closedFirst = true; }); throw Object.freeze({ capture: 'refused' }); } });
		const pending = f.scopes.allocate(CATALOG, options), outcome = pending.then(() => { finished = true; return true; }, () => { finished = true; return false; });
		assert.ok(closing); assert.equal(await outcome, false); await closing; assert.equal(closedFirst, false);
	});
});

test('Lightscaper component-open options Proxy Close reentry cannot leave escaped native owners after parent retirement', async () => {
	await fixture(async f => {
		const scope = await f.scopes.allocate(CATALOG); let closing: Promise<void> | undefined, finished = false, closedFirst = false;
		const options = new Proxy({}, { ownKeys() { closing = f.scopes.close(); void closing.then(() => { if (!finished) closedFirst = true; }); throw Object.freeze({ open: 'refused' }); } });
		const pending = f.scopes.openComponents(scope, options), outcome = pending.then(async value => { finished = true; await value.close(); return true; }, () => { finished = true; return false; });
		assert.ok(closing); assert.equal(await outcome, false); await closing; assert.equal(closedFirst, false);
	});
});

test('Lightscaper real resource consumer may request parent Close without parent releasing its borrowed bytes before callback completion', async () => {
	await fixture(async f => {
		const components = await f.scopes.openComponents(await f.scopes.allocate(CATALOG)), resource = await bundle(62); await install(components.resources, resource);
		const luts = await components.resources.cubeLutResources(); let closing: Promise<void> | undefined;
		await expectResourceCloseAbort(luts.source.withBytes(resource.lut.reference, async bytes => { closing = f.scopes.close(); assert.equal(await remainsPending(closing), true); assert.deepEqual(bytes, resource.lut.bytes); }));
		assert.ok(closing); await closing;
	});
});
