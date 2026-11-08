/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperNativePhotoOriginalsCurrentV1 as Originals } from '../desktop/lightscaper-native-photo-originals-current-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { holdReaderFileReadCurrentV1 as holdRead } from './helpers/lightscaper-native-photo-original-reader-fixture-current.ts';
import { nativeWriterInputCurrentV1 as writerInput } from './helpers/lightscaper-native-media-writer-integration-fixture-current.ts';
import { nativeScopeIntegrationFixtureCurrentV1 as fixture, scopePhotoCurrentV1 as input,
	scopeCatalogRootCurrentV1 as root, scopeOriginalReferenceCurrentV1 as reference, scopeAppDataCurrentV1 as appData,
	SCOPE_CATALOG_CURRENT_V1 as CATALOG, type ComponentsCurrentV1 as Components } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';

async function publish(components: Components, orientation: 1 | 3 = 1) {
	const value = input(orientation); await components.catalog.createCatalog(root());
	await components.media.writeAsset(value.photo.original.storageKey, value.blob, { name: value.photo.original.name, mimeType: value.photo.original.mimeType });
	await components.catalog.publishPhotos(CATALOG, 0, [value.photo]);
	await components.media.catalogOriginals.retain(CATALOG, [reference(value.photo.original, value.photo.id)]);
	return { ...value, request: { catalogId: CATALOG, photoId: value.photo.id, original: value.photo.original } };
}

test('Lightscaper native Original reader outlives the completed component-open request signal', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const stop = new AbortController(), components = await f.scopes.openComponents(await f.scopes.allocate(CATALOG), { signal: stop.signal });
		const value = await publish(components); stop.abort(Symbol('finished open request'));
		const count = await components.originals.withOriginal(value.request, async view => {
			const bytes = await view.read(0, 5); assert.equal(bytes.byteLength, 5); assert.equal(bytes[0], value.bytes[0]); return bytes.byteLength;
		});
		assert.equal(count, 5);
	});
});

test('Lightscaper parent Close cancels escaped Original reads but waits the actual consumer before closing children and releasing exclusion', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const components = await f.scopes.openComponents(await f.scopes.allocate(CATALOG)), value = await publish(components);
		const entered = deferred<void>(), release = deferred<void>(); let blocked = false;
		const consuming = components.originals.withOriginal(value.request, async view => {
			entered.resolve(); await release.promise;
			try { await view.read(0, 5); } catch { blocked = true; }
		});
		const outcome = consuming.then(() => true, () => false); let closing: Promise<void> | undefined;
		try {
			await entered.promise; closing = f.scopes.close(); assert.equal(f.scopes.close(), closing);
			assert.equal(await remainsPending(closing), true);
			assert.equal((await components.catalog.loadPhoto(CATALOG, value.photo.id))?.id, value.photo.id);
			release.resolve(); assert.equal(await outcome, false); await closing; assert.equal(blocked, true);
			const reopened = await f.reopen(); await reopened.openComponents(await reopened.openDefault());
		} finally { release.resolve(); await outcome; await closing; }
	});
});

test('Lightscaper native Original composition captures genuine catalog media and selected settings methods before vending owners', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const components = await f.scopes.openComponents(await f.scopes.allocate(CATALOG)), value = await publish(components);
		let replacements = 0;
		components.catalog.loadPhoto = async () => { replacements++; throw Error('borrowed catalog replacement'); };
		Object.defineProperty(components.media, 'acquireOriginalRead', { value: async () => { replacements++; throw Error('borrowed media replacement'); } });
		Object.defineProperty(components.settings, 'settingsRepository', { value: { ...components.settings.settingsRepository,
			get: async () => { replacements++; throw Error('borrowed settings replacement'); } } });
		assert.equal(await components.originals.withOriginal(value.request, async view => (await view.read(0, 5)).byteLength), 5);
		assert.equal(replacements, 0);
	});
});

test('Lightscaper native Original reading authenticates the stored immutable Original within its actual physical scope', { timeout: 15_000 }, async () => {
	await fixture(async f => {
		const a = await f.scopes.openComponents(await f.scopes.allocate(CATALOG)), b = await f.scopes.openComponents(await f.scopes.allocate(CATALOG));
		const first = await publish(a, 1), second = await publish(b, 3); let delivered = 0;
		await assert.rejects(b.originals.withOriginal(first.request, () => { delivered++; })); assert.equal(delivered, 0);
		assert.equal(await b.originals.withOriginal(second.request, async view => (await view.read(0, 5)).byteLength), 5);
	});
});

test('Lightscaper component Close caches its outer barrier before invoking captured synchronous reader retirement', { timeout: 15_000 }, async () => {
	const descriptor = Object.getOwnPropertyDescriptor(Originals.prototype, 'close'); assert.ok(descriptor);
	const native = Originals.prototype.close; let components: Components | undefined, reentered: Promise<void> | undefined, entered = false;
	Object.defineProperty(Originals.prototype, 'close', { ...descriptor, value: function (this: Originals) {
		const result = Reflect.apply(native, this, []) as Promise<void>;
		if (components && !entered) { entered = true; reentered = components.close(); }
		return result;
	} });
	try {
		await fixture(async f => {
			components = await f.scopes.openComponents(await f.scopes.allocate(CATALOG));
			const closing = components.close(); await closing; await reentered;
			assert.equal(reentered, closing);
		});
	} finally { Object.defineProperty(Originals.prototype, 'close', descriptor); }
});

test('Lightscaper component Close quiesces an idle real stream while joining an independent held Original read', { timeout: 15_000 }, async context => {
	await fixture(async f => {
		const scope = await f.scopes.allocate(CATALOG), components = await f.scopes.openComponents(scope), value = await publish(components);
		const allocation = f.scopes.describe(scope); assert.ok(allocation);
		await holdRead(appData(f.directory, allocation.namespaceToken), async gate => {
			const incoming = writerInput(993, 1024), writer = await components.media.beginAssetWrite(incoming.original.storageKey, incoming.metadata, incoming.options);
			const cancel = (): void => { gate.release(); void writer.abort().catch(() => undefined); void components.close().catch(() => undefined); };
			context.signal.addEventListener('abort', cancel, { once: true });
			let reading: Promise<void> | undefined, closing: Promise<void> | undefined;
			try {
				await writer.write(incoming.bytes.subarray(0, 10));
				reading = components.originals.withOriginal(value.request, async view => { await view.read(0, 5); }); void reading.catch(() => undefined);
				await Promise.race([gate.entered, reading.then(() => { assert.fail('Expected the actual held independent read.'); })]);
				closing = components.close(); assert.equal(await remainsPending(closing), true);
				await writer.abort(); await assert.rejects(writer.write(incoming.bytes.subarray(10)));
				gate.release(); await assert.rejects(reading); await closing; await f.scopes.close(); await f.reopen();
			} finally { gate.release(); context.signal.removeEventListener('abort', cancel); await writer.abort(); await Promise.allSettled([reading, closing]); }
		});
	});
});
