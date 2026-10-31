/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoLibraryHdrMergeSessionCurrentV1 } from '../src/lightscaper/controller/photo-library-hdr-merge-session-current-v1.ts';
import type { PhotoLibraryOriginalSourceCurrentV1 } from '../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { readDesktopPhotoOriginalTicketCurrentV1 as readTicket } from '../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { rawDngFixtureV1 } from './helpers/lightscaper-raw-dng-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { nativeScopeIntegrationFixtureCurrentV1 as fixture, scopeCatalogRootCurrentV1 as root,
	scopeOriginalReferenceCurrentV1 as reference, type ComponentsCurrentV1 as Components } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';

async function create(components: Components, signal: AbortSignal) {
	await components.catalog.createCatalog(root());
	const photos = [1, 3].map((orientation, index) => {
		const raw = rawDngFixtureV1(orientation === 1 ? 1 : 3), seed = photoArchiveFixture(index + 1, raw.bytes);
		return { bytes: raw.bytes, photo: normalizePhotoDocumentCurrentV1({ ...seed.photo,
			original: { ...seed.photo.original, mimeType: 'image/x-adobe-dng', name: `Source ${index}.dng`, width: 32, height: 32 } }) };
	});
	for (const { photo, bytes } of photos) {
		await components.media.writeAsset(photo.original.storageKey, new Blob([bytes]), { name: photo.original.name, mimeType: photo.original.mimeType });
		await components.media.catalogOriginals.retain(photo.catalogId, [reference(photo.original, photo.id)]);
	}
	await components.catalog.publishPhotos('catalog-1', 0, photos.map(value => value.photo));
	const transport = components.originalTickets.transport, tickets = new Set<string>(), files = new Set<File>();
	const calls = { acquired: 0, retired: 0 }, hooks = { acquire: async (): Promise<void> => undefined, retire: async (): Promise<void> => undefined };
	const source: PhotoLibraryOriginalSourceCurrentV1 = { async acquire(request) {
		assert.equal(this, source); const ticket = readTicket(await transport.open(request), request); tickets.add(ticket.id);
		const bytes = await transport.read(ticket, 0, request.original.byteLength); assert.ok(bytes instanceof Uint8Array);
		const body = new File([new Uint8Array(bytes)], request.original.name); bytes.fill(0); files.add(body); calls.acquired++;
		await hooks.acquire();
		return { body, async close() { await hooks.retire(); await transport.close({ id: ticket.id }); tickets.delete(ticket.id); files.delete(body); calls.retired++; } };
	} };
	const ports = { catalog: components.catalog, originalSource: source, journal: components.settings.settingsRepository,
		media: { writeAsset: components.media.writeAsset, custody: components.media.catalogOriginals },
		initialize: async () => root(), closeResources: async () => undefined };
	const port = createPhotoLibraryHdrMergeSessionCurrentV1({ ports, ready: async () => 'catalog-1', resetReady: () => undefined,
		operation: async <Result>(run: (signal: AbortSignal) => Promise<Result>, caller?: AbortSignal, admit?: () => void) => {
			const admitted = caller ? AbortSignal.any([caller, signal]) : signal; admitted.throwIfAborted(); admit?.(); return run(admitted);
		}, mutate: async () => { assert.fail('This qualification does not publish an HDR asset.'); } });
	return { port, source, calls, hooks, files, photos,
		request: () => ({ schemaVersion: 1 as const, inputs: photos.map(({ photo }) => ({ photoId: photo.id, expectedRevision: photo.revision, exposureMultiplier: 1 })),
			referenceIndex: 0, alignment: 'none' as const, deghost: { mode: 'off' as const, threshold: .15 }, fileName: 'Scoped.lshdr' }),
		async close() { await Promise.all([...tickets].map(id => transport.close({ id }))); },
	};
}

test('Current HDR child admits its scoped Original capability independently of backup loading', { timeout: 15_000 }, async context => {
	await fixture(async f => {
		const components = await f.scopes.openComponents(await f.scopes.allocate('catalog-1')), selected = await create(components, context.signal);
		try {
			assert.ok(selected.port, 'Scoped-only HDR sources require their real canonical child.');
			const result = await selected.port.readSelection({ schemaVersion: 1, photoIds: selected.photos.map(({ photo }) => photo.id) }, { signal: context.signal });
			assert.equal(result.sources.length, 2); assert.equal(selected.calls.acquired, 0);
		} finally { await selected.close(); }
	});
});

test('Current HDR canonical sampling joins cancelled native-ticket File acquisition and retirement', { timeout: 15_000 }, async context => {
	await fixture(async f => {
		const components = await f.scopes.openComponents(await f.scopes.allocate('catalog-1')), selected = await create(components, context.signal);
		const entered = deferred<void>(), acquired = deferred<void>(), retiring = deferred<void>(), retired = deferred<void>(), stop = new AbortController();
		let work: Promise<unknown> | undefined;
		const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
		const cancel = () => { acquired.resolve(); retired.resolve(); stop.abort(); }; context.signal.addEventListener('abort', cancel, { once: true });
		try {
			assert.ok(selected.port); selected.hooks.acquire = async () => { entered.resolve(); await acquired.promise; };
			assert.ok(selected.port.withPreview);
			selected.hooks.retire = async () => { retiring.resolve(); await retired.promise; };
			// Model only directory admission. Cancellation precedes decoding and
			// pixel staging; no substitute pixels or writable may be produced.
			Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { async getDirectory() {
				return { async getDirectoryHandle(name: string) { assert.equal(name, 'audio-editor-exports'); return {
					getFileHandle: async () => { assert.fail('Cancelled source must precede pixel staging.'); },
					removeEntry: async () => { assert.fail('No staged pixels exist.'); },
				}; } };
			} } } });
			work = selected.port.withPreview(selected.request(), async () => { assert.fail('Cancelled acquisition must not publish a preview.'); }, { signal: stop.signal });
			const outcome = work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
			await Promise.race([entered.promise, work.then(() => { assert.fail('HDR sampling ended before source acquisition.'); })]);
			assert.equal(selected.files.size, 1); stop.abort(new DOMException('Cancel native HDR sampling.', 'AbortError')); acquired.resolve();
			await Promise.race([retiring.promise, work.then(() => { assert.fail('HDR sampling ended before Original retirement.'); })]);
			assert.equal(await remainsPending(work), true); retired.resolve(); const result = await outcome;
			assert.equal(result.failed, true); assert.equal(result.error, stop.signal.reason); assert.deepEqual(selected.calls, { acquired: 1, retired: 1 });
			assert.equal(selected.files.size, 0);
		} finally {
			acquired.resolve(); retired.resolve(); await Promise.allSettled([work]); context.signal.removeEventListener('abort', cancel);
			try { await selected.close(); } finally { if (priorNavigator) Object.defineProperty(globalThis, 'navigator', priorNavigator); else Reflect.deleteProperty(globalThis, 'navigator'); }
		}
	});
});
