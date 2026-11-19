/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { PhotoLibrarySessionPortsCurrentV1 } from '../../src/lightscaper/controller/photo-library-session-ports-current-v1.ts';
import type { PhotoLibraryOriginalSourceCurrentV1 } from '../../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { PhotoLibrarySessionLifetime } from '../../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { createPhotoLibrarySessionExportJournalPortV1 } from '../../src/lightscaper/controller/photo-library-session-export-sidecar.ts';
import type { PhotoLibraryExportJournalHostCurrentV1 } from '../../src/lightscaper/controller/internal/photo-library-export-journal-kernel-v1.ts';
import { withPhotoLibraryImageHandoffForProfileV1 } from '../../src/lightscaper/controller/internal/photo-library-image-handoff-kernel-v1.ts';
import type { PhotoLibraryImageHandoffViewV2 } from '../../src/common/editor/photo-library-image-handoff-port-v2.ts';
import { readDesktopPhotoOriginalTicketIdCurrentV1 } from '../../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
import { nativeOriginalTicketFixtureCurrentV1, readTicket, ticketShaCurrentV1, checkTicketTestSignalCurrentV1 } from './lightscaper-native-photo-original-ticket-fixture-current.ts';
export { nativeTicketTestCurrentV1 as exportOriginalTestCurrentV1, deferred, remainsPending } from './lightscaper-native-photo-original-ticket-fixture-current.ts';
export { ticketShaCurrentV1 as exportOriginalShaCurrentV1 } from './lightscaper-native-photo-original-ticket-fixture-current.ts';

/** A Node test adapter lends a real File over the genuine bounded Main ticket
 * transport. It is not the renderer OPFS adapter or production IPC activation.
 * Native FS, SQLite, stored Photo, Original custody and ticket retirement stay
 * actual; source-only behavior has no bare-loader or positive verifier stub. */
export async function scopedExportOriginalFixtureCurrentV1(context: TestContext,
	run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>): Promise<void> {
	await nativeOriginalTicketFixtureCurrentV1(async native => {
		const f = createFixture(native), abort = (): void => { void f.close().catch(() => undefined); };
		context.signal.addEventListener('abort', abort, { once: true }); if (context.signal.aborted) abort();
		let failed = false, primary: unknown;
		try { await run(f); } catch (error) { failed = true; primary = error; }
		context.signal.removeEventListener('abort', abort);
		try { await f.close(); } catch (cleanup) {
			if (failed) throw new AggregateError([primary, cleanup], 'Scoped export test and lifetime retirement failed.', { cause: cleanup }); throw cleanup;
		}
		if (failed) throw primary;
	}, { length: 65_536 });
}

type Native = Parameters<Parameters<typeof nativeOriginalTicketFixtureCurrentV1>[0]>[0];
function createFixture(native: Native) {
	const lifetime = new PhotoLibrarySessionLifetime(), events: string[] = [];
	let acquisitions = 0, releases = 0, fallbacks = 0, loads = 0;
	const hooks = { acquired: async (): Promise<void> => undefined, released: async (): Promise<void> => undefined,
		verified: async (): Promise<void> => undefined, loaded: async (_count: number): Promise<void> => undefined,
		body: (body: File): Blob => body };
	const photo = native.entry.photo, request = Object.freeze({ catalogId: photo.catalogId, photoId: photo.id,
		versionId: photo.activeVersionId, expectedRevision: photo.revision });
	const originalSource: PhotoLibraryOriginalSourceCurrentV1 = {
		async acquire(value, options = {}) {
			assert.equal(this, originalSource); assert.deepEqual(value, native.request);
			options.signal?.throwIfAborted(); acquisitions++; events.push('acquire');
			const rawTicket = await native.server.transport.open(value), ticketId = readDesktopPhotoOriginalTicketIdCurrentV1(rawTicket);
			let releasing: Promise<void> | undefined;
			const close = (): Promise<void> => {
				releasing ??= (async () => { await native.server.transport.close({ id: ticketId }); releases++; events.push('lease-close'); await hooks.released(); })();
				return releasing;
			};
			let bytes: Uint8Array<ArrayBuffer> | undefined;
			try {
				const ticket = readTicket(rawTicket, value);
				bytes = new Uint8Array(ticket.original.byteLength);
				for (let offset = 0; offset < bytes.length;) {
					const length = Math.min(1024 * 1024, bytes.length - offset);
					const part = await native.server.transport.read(ticket, offset, length); assert.ok(part instanceof Uint8Array);
					assert.equal(part.byteLength, length); bytes.set(part, offset); part.fill(0); offset += length;
				}
				assert.equal(ticketShaCurrentV1(bytes), photo.original.contentSha256);
				const body = hooks.body(new File([bytes], photo.original.name, { type: photo.original.mimeType }));
				await hooks.acquired(); return { body, close };
			} catch (error) {
				try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Test ticket read and close failed.', { cause: cleanup }); }
				throw error;
			} finally { bytes?.fill(0); }
		},
	};
	const catalog: PhotoLibrarySessionPortsCurrentV1['catalog'] = { loadCatalog: native.catalog.loadCatalog.bind(native.catalog), publishPhotos: native.catalog.publishPhotos.bind(native.catalog),
		savePhoto: native.catalog.savePhoto.bind(native.catalog), saveCatalog: native.catalog.saveCatalog.bind(native.catalog), readSummaryPage: native.catalog.readSummaryPage.bind(native.catalog),
		readQueryPage: native.catalog.readQueryPage.bind(native.catalog), rebuildQueryIndexPage: native.catalog.rebuildQueryIndexPage.bind(native.catalog),
		async loadPhoto(catalogId, photoId) { assert.equal(this, catalog); const value = await native.catalog.loadPhoto(catalogId, photoId);
			loads++; await hooks.loaded(loads); events.push(`load-${loads}`); return value; } };
	const verifyResources: NonNullable<PhotoLibrarySessionPortsCurrentV1['verifyResources']> = async (value, signal) => {
		await native.ports.verifyResources!(value, signal); events.push('resources-verified'); await hooks.verified();
	};
	const fallback = { async loadOriginal(original: typeof photo.original, signal?: AbortSignal) {
		assert.equal(this, fallback); assert.deepEqual(original, photo.original); signal?.throwIfAborted(); fallbacks++;
		return new File([native.entry.bytes], photo.original.name, { type: photo.original.mimeType });
	} };
	const ports: PhotoLibrarySessionPortsCurrentV1 = { catalog, media: native.ports.media, journal: native.settings.settingsRepository,
		originalSource, verifyResources, cubeLutResources: native.resources.cubeLutResources, maskRasterResources: native.resources.maskRasterResources,
		initialize: async () => (await native.catalog.loadCatalog(photo.catalogId))!, closeResources: async () => undefined };
	const host = { settings: native.settings.settingsRepository, catalog, originalSource,
		ready: async () => photo.catalogId,
		operation: lifetime.operation.bind(lifetime), verifyResources,
		async loadOriginal(original: typeof photo.original, signal?: AbortSignal) { return fallback.loadOriginal(original, signal); },
	} satisfies PhotoLibraryExportJournalHostCurrentV1 & { originalSource: PhotoLibraryOriginalSourceCurrentV1 };
	return { native, lifetime, ports, host, hooks, events, request, photo, originalSource, fallback,
		calls: () => ({ acquisitions, releases, fallbacks, loads }),
		openJournal: () => createPhotoLibrarySessionExportJournalPortV1('current3', host).open(),
		image<Result>(consume: (view: Readonly<PhotoLibraryImageHandoffViewV2>) => Result | Promise<Result>, signal?: AbortSignal) {
			return lifetime.operation(admitted => withPhotoLibraryImageHandoffForProfileV1('current3', ports, photo.catalogId, request,
				view => { assert.equal(view.schemaVersion, 2); return consume(view as Readonly<PhotoLibraryImageHandoffViewV2>); }, admitted), signal);
		},
		async provePinned() {
			await native.media.catalogOriginals.release(photo.catalogId, [photo.id]);
			try { await assert.rejects(native.media.deleteAsset(photo.original.storageKey), /reader|retained|active|pin/iu); }
			finally { await native.media.catalogOriginals.retain(photo.catalogId, [{ photoId: photo.id, sourceId: photo.original.id,
				assetId: photo.original.storageKey, sha256: photo.original.contentSha256!, size: photo.original.byteLength }]); }
		},
		close: () => lifetime.close(async () => undefined),
	};
}

export async function exportReachedCurrentV1(barrier: Promise<void>, work: Promise<unknown>): Promise<void> {
	checkTicketTestSignalCurrentV1();
	await Promise.race([barrier, work.then(() => { throw new Error('Export ended before its required ownership barrier.'); })]);
	checkTicketTestSignalCurrentV1();
}
export async function exportExactFailureCurrentV1(work: Promise<unknown>, expected: unknown): Promise<void> {
	let refused = false; await work.then(() => undefined, (error: unknown) => { refused = true; assert.equal(error, expected); }); assert.equal(refused, true);
}
