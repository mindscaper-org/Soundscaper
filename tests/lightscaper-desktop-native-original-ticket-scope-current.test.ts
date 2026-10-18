/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { LightscaperNativeOriginalStoreCurrentV1 as OriginalStore } from '../desktop/lightscaper-native-original-store-current-v1.ts';
import { readDesktopPhotoOriginalTicketCurrentV1 as readTicket } from '../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { holdReaderFileReadCurrentV1 as holdRead } from './helpers/lightscaper-native-photo-original-reader-fixture-current.ts';
import { nativeWriterInputCurrentV1 as writerInput } from './helpers/lightscaper-native-media-writer-integration-fixture-current.ts';
import { nativeScopeIntegrationFixtureCurrentV1 as fixture, scopePhotoCurrentV1 as input, scopeAppDataCurrentV1 as appData,
	scopeCatalogRootCurrentV1 as root, scopeOriginalReferenceCurrentV1 as reference,
	SCOPE_CATALOG_CURRENT_V1 as CATALOG, type ComponentsCurrentV1 as Components } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';

async function publish(components: Components) {
	const value = input(); await components.catalog.createCatalog(root());
	await components.media.writeAsset(value.photo.original.storageKey, value.blob, { name: value.photo.original.name, mimeType: value.photo.original.mimeType });
	await components.catalog.publishPhotos(CATALOG, 0, [value.photo]);
	await components.media.catalogOriginals.retain(CATALOG, [reference(value.photo.original, value.photo.id)]);
	return { ...value, request: { catalogId: CATALOG, photoId: value.photo.id, original: value.photo.original } };
}

test('Lightscaper Scope vends its actual ticket transport beyond the open request and captures ticket retirement', { timeout: 15_000 }, async context => {
	await fixture(async f => {
		const stop = new AbortController(), components = await f.scopes.openComponents(await f.scopes.allocate(CATALOG), { signal: stop.signal });
		const cancel = () => { void components.close().catch(() => undefined); }; context.signal.addEventListener('abort', cancel, { once: true });
		try {
			const value = await publish(components); stop.abort(Symbol('completed open request'));
			assert.ok(components.originalTickets, 'Selected components must own the main ticket server.');
			const transport = components.originalTickets.transport, ticket = readTicket(await transport.open(value.request), value.request);
			const part = await transport.read(ticket, 0, 5); assert.ok(part instanceof Uint8Array); assert.equal(part.byteLength, 5); assert.equal(part[0], value.bytes[0]);
			let replacements = 0;
			components.originalTickets.close = async () => { replacements++; throw Error('Replaced ticket retirement.'); };
			components.originals.close = async () => { replacements++; throw Error('Replaced reader retirement.'); };
			const closing = components.close(); assert.equal(closing, components.close()); await closing;
			await transport.close({ id: ticket.id }); await assert.rejects(transport.read(ticket, 0, 1)); assert.equal(replacements, 0);
			await f.scopes.close(); await f.reopen();
		} finally { context.signal.removeEventListener('abort', cancel); await components.close(); }
	});
});

test('Lightscaper component retirement quiesces an idle real writer before joining its ticket range', { timeout: 15_000 }, async context => {
	const descriptor = Object.getOwnPropertyDescriptor(OriginalStore.prototype, 'readBinding'); assert.ok(descriptor);
	const native = OriginalStore.prototype.readBinding, entered = deferred<void>();
	Object.defineProperty(OriginalStore.prototype, 'readBinding', { ...descriptor, value: function (this: OriginalStore, ...args: Parameters<OriginalStore['readBinding']>) {
		const work = Reflect.apply(native, this, args) as ReturnType<OriginalStore['readBinding']>; entered.resolve(); return work;
	} });
	try {
		await fixture(async f => {
			const components = await f.scopes.openComponents(await f.scopes.allocate(CATALOG)), value = await publish(components);
			assert.ok(components.originalTickets); const transport = components.originalTickets.transport, ticket = readTicket(await transport.open(value.request), value.request);
			const incoming = writerInput(994, 1024), writer = await components.media.beginAssetWrite(incoming.original.storageKey, incoming.metadata, incoming.options);
			const cancel = () => { void writer.abort().catch(() => undefined); void components.close().catch(() => undefined); };
			context.signal.addEventListener('abort', cancel, { once: true });
			let reading: Promise<unknown> | undefined, closing: Promise<void> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await writer.write(incoming.bytes.subarray(0, 10)); reading = transport.read(ticket, 0, 5); void reading.catch(() => undefined);
				await Promise.race([entered.promise, reading.then(() => { assert.fail('Expected a range queued behind the real idle writer.'); })]);
				closing = components.close(); const retired = await Promise.race([closing.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => { resolve(false); }, 2000); })]);
				assert.equal(retired, true, 'Ticket retirement must release the callback after quiescing its blocking writer.');
				await assert.rejects(reading); await assert.rejects(writer.write(incoming.bytes.subarray(10))); await transport.close({ id: ticket.id });
			} finally { clearTimeout(timer); context.signal.removeEventListener('abort', cancel); await writer.abort(); await Promise.allSettled([reading, closing]); }
		});
	} finally { Object.defineProperty(OriginalStore.prototype, 'readBinding', descriptor); }
});

test('Lightscaper parent Scope Close joins the real held ticket read before physical owners and exclusion retire', { timeout: 15_000 }, async context => {
	await fixture(async f => {
		const scope = await f.scopes.allocate(CATALOG), components = await f.scopes.openComponents(scope), value = await publish(components);
		assert.ok(components.originalTickets); const transport = components.originalTickets.transport, ticket = readTicket(await transport.open(value.request), value.request);
		const allocation = f.scopes.describe(scope); assert.ok(allocation);
		await holdRead(appData(f.directory, allocation.namespaceToken), async gate => {
			const cancel = () => { gate.release(); void f.scopes.close().catch(() => undefined); }; context.signal.addEventListener('abort', cancel, { once: true });
			const reading = transport.read(ticket, 0, 5); void reading.catch(() => undefined); let closing: Promise<void> | undefined;
			try {
				await Promise.race([gate.entered, reading.then(() => { assert.fail('Expected the actual physical read barrier.'); })]);
				closing = f.scopes.close(); assert.equal(closing, f.scopes.close()); assert.equal(await remainsPending(closing), true);
				assert.equal((await components.catalog.loadPhoto(CATALOG, value.photo.id))?.id, value.photo.id);
				gate.release(); await assert.rejects(reading); await closing; await transport.close({ id: ticket.id }); await f.reopen();
			} finally { gate.release(); context.signal.removeEventListener('abort', cancel); await Promise.allSettled([reading, closing]); }
		});
	});
});
