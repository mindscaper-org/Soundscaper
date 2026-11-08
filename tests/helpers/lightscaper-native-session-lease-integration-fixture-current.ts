/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from '../../desktop/lightscaper-native-photo-media-current-v1.ts';
import type { LightscaperNativePhotoSessionLeaseCurrentV1 as Lease } from '../../desktop/lightscaper-native-photo-session-lease-current-v1.ts';
import { PhotoLibrarySessionLifetime } from '../../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { PhotoLibrarySessionCurrentV1 } from '../../src/lightscaper/controller/photo-library-session-current-v1.ts';
import { withPhotoLibraryOriginalCurrentV1 } from '../../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { withPhotoLibraryOriginalGroupCurrentV1 } from '../../src/lightscaper/controller/photo-library-original-group-current-v1.ts';
import { DesktopPhotoOriginalSourceCurrentV1 } from '../../src/lightscaper/desktop-photo-original-source-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { originalGroupFixtureCurrentV1 } from './lightscaper-desktop-original-group-fixture-current.ts';
import { scopePhotoCurrentV1, scopeResourceBundleCurrentV1, installScopeResourceBundleCurrentV1,
	scopeResourcePhotoCurrentV1, scopeOriginalReferenceCurrentV1 as reference } from './lightscaper-native-library-scope-integration-fixture-current.ts';
export { remainsPending } from './async-test-control.ts';
export { Scopes, Media };
export type { Lease };

type Selected = Awaited<ReturnType<Scopes['openSelected']>>;
type Local = Readonly<{ close(): Promise<void> }>;
export const sessionLeaseShaCurrentV1 = (value: unknown): string => {
	assert.ok(value instanceof Uint8Array, 'Hash only actual native bytes.'); return createHash('sha256').update(value).digest('hex');
};
/** Reflection follows actual selected Catalog, body, Root1 and resource writes.
 * A missing entrypoint is a behavioral RED, not a new-module import failure. */
export function openNativeSessionLeaseCurrentV1(scopes: Scopes, scope: Selected['scope'], local: Local,
	options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<Lease>> {
	const method: unknown = Reflect.get(scopes, 'openSessionLease');
	assert.equal(typeof method, 'function', 'Actual Scopes must own a selected Session storage lease.');
	return Reflect.apply(method as (...args: unknown[]) => Promise<Readonly<Lease>>, scopes, [scope, local, options]);
}

export async function nativeSessionLeaseFixtureCurrentV1(context: TestContext,
	run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>): Promise<void> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper selected session lease ')));
	let scopes: Scopes | undefined, fixture: Awaited<ReturnType<typeof createFixture>> | undefined, failed = false, primary: unknown;
	const cancel = (): void => { fixture?.release(); if (scopes) void scopes.close().catch(() => undefined); };
	context.signal.addEventListener('abort', cancel, { once: true }); if (context.signal.aborted) cancel();
	try {
		scopes = await Scopes.open({ appDataPath: directory }); const selected = await scopes.openSelected({ name: 'Native selected lease' });
		const seed = await scopes.openComponents(selected.scope);
		let seeded = false;
		try {
			const resource = await scopeResourceBundleCurrentV1(7); await installScopeResourceBundleCurrentV1(seed.resources, resource);
			const entry = scopePhotoCurrentV1(), rich = scopeResourcePhotoCurrentV1(Array.from({ length: 6 }, () => resource));
			const photos = [0, 1].map(index => normalizePhotoDocumentCurrentV1({ ...rich, catalogId: selected.catalogId, id: `lease-photo-${index}`,
				original: { ...entry.photo.original, id: `lease-original-${index}`, storageKey: 'lease-asset' }, metadata: entry.photo.metadata }));
			await seed.media.writeAsset('lease-asset', entry.blob, { name: photos[0]!.original.name, mimeType: entry.blob.type });
			await seed.media.catalogOriginals.retain(selected.catalogId, photos.map(photo => reference(photo.original, photo.id)));
			const root = await seed.catalog.loadCatalog(selected.catalogId); assert.ok(root);
			await seed.catalog.publishPhotos(root.id, root.revision, photos); await seed.close(); seeded = true;
			context.signal.throwIfAborted(); fixture = await createFixture(context, directory, scopes, selected, photos, entry.bytes, resource); await run(fixture);
		} finally { if (!seeded) await seed.close(); }
	} catch (error) { failed = true; primary = error; }
	const failures: unknown[] = [];
	try { fixture?.release(); await fixture?.close(); } catch (error) { failures.push(error); }
	try { await scopes?.close(); } catch (error) { failures.push(error); }
	context.signal.removeEventListener('abort', cancel);
	if (failures.length) throw new AggregateError([...(failed ? [primary] : []), ...failures], 'Native Session lease test did not retire; files retained.');
	await rm(directory, { recursive: true, force: false }); if (failed) throw primary;
}

async function createFixture(context: TestContext, directory: string, scopes: Scopes, selected: Selected,
	photos: readonly ReturnType<typeof normalizePhotoDocumentCurrentV1>[], bytes: Uint8Array<ArrayBuffer>, resource: Awaited<ReturnType<typeof scopeResourceBundleCurrentV1>>) {
	const storage = originalGroupFixtureCurrentV1(context), lifetime = new PhotoLibrarySessionLifetime(), gates = new Set<() => void>(), events: string[] = [];
	const active = new Set<Promise<unknown>>(); let source: DesktopPhotoOriginalSourceCurrentV1 | undefined, session: PhotoLibrarySessionCurrentV1 | undefined;
	let localClosing: Promise<void> | undefined, localCloses = 0, closing: Promise<void> | undefined;
	const local = { close(): Promise<void> {
		assert.equal(this, local); if (localClosing) return localClosing; localCloses++; events.push('local-close');
		localClosing = Promise.resolve().then(async () => {
			const results = await Promise.allSettled([lifetime.close(async () => undefined), ...(session ? [session.close()] : [])]);
			const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			try { await source?.close(); } catch (error) { errors.push(error); }
			if (errors.length) throw new AggregateError(errors, 'Actual local consumers did not retire.'); events.push('local-retired');
		}); return localClosing;
	} };
	const actualLocalClose = local.close;
	let lease: Readonly<Lease>;
	try { lease = await openNativeSessionLeaseCurrentV1(scopes, selected.scope, local); }
	catch (primary) {
		try { await storage.close(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Lease admission and fixture retirement failed.', { cause: cleanup }); } throw primary;
	}
	const c = lease.components;
	try { source = new DesktopPhotoOriginalSourceCurrentV1(c.originalTickets.transport, { storage: storage.storage }); }
	catch (primary) {
		const errors: unknown[] = [primary];
		for (const owner of [storage, lease]) { try { await owner.close(); } catch (error) { errors.push(error); } }
		if (errors.length > 1) throw new AggregateError(errors, 'Actual Source construction and lease retirement failed.', { cause: primary }); throw primary;
	}
	const actualSource = source;
	const requests = photos.map(photo => Object.freeze({ catalogId: photo.catalogId, photoId: photo.id, original: photo.original }));
	const release = (): void => { for (const done of gates) done(); };
	const track = <Result>(work: Promise<Result>): Promise<Result> => {
		active.add(work); void work.then(() => { active.delete(work); }, () => { active.delete(work); }); return work;
	};
	return { directory, scopes, selected, lease, components: c, local, lifetime, source: actualSource, storage, requests, photos, bytes, resource, events,
		counts: () => ({ localCloses }), release,
		gate() { const gate = storage.gate(); gates.add(gate.release); return gate; },
		async reached(barrier: Promise<void>, work: Promise<unknown>): Promise<void> {
			context.signal.throwIfAborted(); await Promise.race([barrier, work.then(() => { throw new Error('Actual consumer ended before required barrier.'); })]); context.signal.throwIfAborted();
		},
		withOriginal<Result>(consume: (body: Blob, signal: AbortSignal) => Result | Promise<Result>, grouped = false): Promise<Result> {
			return track(lifetime.operation(signal => grouped
				? withPhotoLibraryOriginalGroupCurrentV1(actualSource, requests, bodies => consume(bodies[0]!, signal), signal)
				: withPhotoLibraryOriginalCurrentV1(actualSource, requests[0]!, body => consume(body, signal), signal), lease.signal));
		},
		operation<Result>(run: (signal: AbortSignal) => Promise<Result>): Promise<Result> { return track(lifetime.operation(run, lease.signal)); },
		createSession(): PhotoLibrarySessionCurrentV1 {
			assert.equal(session, undefined);
			session = new PhotoLibrarySessionCurrentV1({ catalog: c.catalog, stacks: c.catalog, smartCollections: c.catalog,
				originalSource: actualSource, media: { writeAsset: c.media.writeAsset, custody: c.media.catalogOriginals }, journal: c.settings.settingsRepository,
				developPresetSettings: c.settings.settingsRepository, exportJournalSettings: c.settings.settingsRepository, exportPresetSettings: c.settings.settingsRepository,
				exclusive: lease.exclusive, cubeLutResources: c.resources.cubeLutResources, maskRasterResources: c.resources.maskRasterResources,
				verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, c.resources, signal),
				initialize: async () => { const root = await c.catalog.loadCatalog(lease.catalogId); assert.ok(root); return root; },
				backup: { readSnapshot: c.catalog.readSnapshot.bind(c.catalog), captureSmartCollectionArchiveV1: c.catalog.captureSmartCollectionArchiveV1.bind(c.catalog) },
				// This is the local phase only. Calling lease.close here would cycle.
				closeResources: () => actualSource.close() }); return session;
		},
		async provePinned(): Promise<void> {
			const peer = await Media.open({ appDataPath: directory }); let failed = false, primary: unknown;
			try {
				await peer.catalogOriginals.release(lease.catalogId, photos.map(photo => photo.id));
				try { await assert.rejects(peer.deleteAsset('lease-asset'), /reader|active|pin/iu); }
				finally { await peer.catalogOriginals.retain(lease.catalogId, photos.map(photo => reference(photo.original, photo.id))); }
			} catch (error) { failed = true; primary = error; }
			try { await peer.close(); } catch (cleanup) { throw new AggregateError([...(failed ? [primary] : []), cleanup], 'Actual peer did not retire.', { cause: cleanup }); }
			if (failed) throw primary;
		},
		close(): Promise<void> {
			closing ??= Promise.resolve().then(async () => {
				release(); const results = await Promise.allSettled([Reflect.apply(actualLocalClose, local, []) as Promise<void>, ...active]);
				const first = results[0], errors: unknown[] = first?.status === 'rejected' ? [first.reason as unknown] : [];
				for (const owner of [actualSource, storage, lease]) { try { await owner.close(); } catch (error) { errors.push(error); } }
				if (errors.length) throw new AggregateError(errors, 'Actual native Session lease fixture retirement failed.');
			}); return closing;
		},
	};
}
