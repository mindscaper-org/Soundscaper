/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { PhotoLibrarySessionCurrentV1 } from '../../src/lightscaper/controller/photo-library-session-current-v1.ts';
import type { PhotoLibraryOriginalRequestCurrentV1, PhotoLibraryOriginalSourceCurrentV1, PhotoLibraryOriginalGroupLeaseCurrentV1 } from '../../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import type { PhotoLibraryCollectionHandoffRequestV1 } from '../../src/common/editor/photo-library-collection-handoff-port-v1.ts';
import type { PhotoLibraryCollectionHandoffViewV2 } from '../../src/common/editor/photo-library-collection-handoff-port-v2.ts';
import { repairSequenceCurrentFixture, type RepairSequenceFixtureOptions } from './lightscaper-repair-sequence-current-fixture.ts';
import { deferred } from './async-test-control.ts';
export { remainsPending } from './async-test-control.ts';

type Group = PhotoLibraryOriginalGroupLeaseCurrentV1;
type GroupSource = PhotoLibraryOriginalSourceCurrentV1 & {
	acquireGroup(requests: readonly Readonly<PhotoLibraryOriginalRequestCurrentV1>[], options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<Group>>;
};
/** Production Current/Web repository algorithms and actual stored bodies from
 * the instrumented IDB fixture. This is not OS SQLite, native tickets or OPFS.
 * Native integration is a separate real-owner fixture after protocol adoption. */
export async function scopedCollectionWebFixtureCurrentV1(context: TestContext,
	run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>, options: RepairSequenceFixtureOptions = {}): Promise<void> {
	const base = await repairSequenceCurrentFixture(options), f = createFixture(context, base);
	let failed = false, primary: unknown;
	try { await run(f); } catch (error) { failed = true; primary = error; }
	try { await f.close(); } catch (cleanup) {
		if (failed && !Object.is(primary, cleanup)) throw new AggregateError([primary, cleanup], 'Collection test and actual repository retirement failed.', { cause: cleanup }); throw cleanup;
	}
	if (failed) throw primary;
}
function createFixture(context: TestContext, base: Awaited<ReturnType<typeof repairSequenceCurrentFixture>>) {
	const releases = new Set<() => void>(), active = new Set<Promise<unknown>>(), requests: Readonly<PhotoLibraryOriginalRequestCurrentV1>[][] = [];
	let groups = 0, closes = 0, individuals = 0;
	const hooks = { open: async (): Promise<void> => undefined, close: async (): Promise<void> => undefined,
		body: (_index: number, body: File): Blob => body };
	const originalSource: GroupSource = {
		async acquire() { individuals++; assert.fail('Collection cannot acquire a per-file prefix.'); },
		async acquireGroup(values, options = {}) {
			assert.equal(this, originalSource); options.signal?.throwIfAborted(); groups++; base.events.push('group-open');
			requests.push([...values]); const bodies: Blob[] = [], aliases = new Map<string, File>();
			for (const value of values) {
				const photo = await base.catalog.loadPhoto(value.catalogId, value.photoId); assert.ok(photo);
				assert.deepEqual(value.original, photo.original); await base.media.verifyOriginal(value.original, options.signal);
				const body = await base.media.mediaRepository.loadAsset(value.original.storageKey, { signal: options.signal, expectedSize: value.original.byteLength }); assert.ok(body instanceof Blob);
				const file = aliases.get(value.original.contentSha256) ?? new File([body], value.original.name, { type: value.original.mimeType });
				aliases.set(value.original.contentSha256, file); bodies.push(hooks.body(bodies.length, file));
			}
			let closing: Promise<void> | undefined;
			const close = (): Promise<void> => { closing ??= Promise.resolve().then(async () => { closes++; base.events.push('group-close'); await hooks.close(); }); return closing; };
			try { await hooks.open(); return Object.freeze({ bodies: Object.freeze(bodies), close }); }
			catch (error) { try { await close(); } catch (cleanup) {
				if (!Object.is(error, cleanup)) throw new AggregateError([error, cleanup], 'Collection fixture open and close failed.', { cause: cleanup });
			} throw error; }
		},
	};
	const ports = { ...base.ports, originalSource, initialize: base.ports.initialize.bind(base.ports),
		cubeLutResources: base.ports.cubeLutResources!.bind(base.ports), maskRasterResources: base.ports.maskRasterResources!.bind(base.ports),
		// The base fixture is the sole physical owner. Join every child Session
		// below before closing that actual repository owner.
		closeResources: async (): Promise<void> => undefined }; Reflect.deleteProperty(ports, 'backup');
	const session = new PhotoLibrarySessionCurrentV1(ports), sessions = new Set([session]);
	const release = (): void => { for (const done of releases) done(); };
	const abort = (): void => { release(); for (const owner of sessions) void owner.close().catch(() => undefined); };
	context.signal.addEventListener('abort', abort, { once: true }); if (context.signal.aborted) abort();
	let closing: Promise<void> | undefined;
	return { base, ports, session, originalSource, hooks, requests,
		calls: () => ({ groups, closes, individuals }),
		registerSession(owner: PhotoLibrarySessionCurrentV1): void { sessions.add(owner); if (context.signal.aborted) void owner.close().catch(() => undefined); },
		gate() { const entered = deferred<void>(), retired = deferred<void>(); const done = (): void => { entered.resolve(); retired.resolve(); };
			releases.add(done); return { entered: entered.promise, release: () => { retired.resolve(); },
				async hold() { entered.resolve(); await retired.promise; } }; },
		async reached(barrier: Promise<void>, work: Promise<unknown>) {
			context.signal.throwIfAborted(); await Promise.race([barrier, work.then(() => { throw new Error('Collection ended before its ownership barrier.'); })]); context.signal.throwIfAborted();
		},
		capture<Value>(consume: (view: Readonly<PhotoLibraryCollectionHandoffViewV2>) => Value | Promise<Value>,
			options: Readonly<{ signal?: AbortSignal }> = {}, binding: Readonly<PhotoLibraryCollectionHandoffRequestV1> = base.manualBinding): Promise<Value> {
			assert.ok(session.collectionHandoffCurrent); const work = session.collectionHandoffCurrent.withCapture(binding, consume, options); active.add(work);
			void work.then(() => { active.delete(work); }, () => { active.delete(work); }); return work;
		},
		close(): Promise<void> {
			closing ??= Promise.resolve().then(async () => {
				context.signal.removeEventListener('abort', abort); release();
				const cleanup: unknown[] = [];
				for (const owner of sessions) { try { await owner.close(); } catch (error) { cleanup.push(error); } }
				await Promise.allSettled([...active]); try { await base.close(); } catch (error) { cleanup.push(error); }
				if (cleanup.length === 1) throw cleanup[0]; if (cleanup.length) throw new AggregateError(cleanup, 'Collection repositories did not retire.');
			}); return closing;
		},
	};
}
export async function collectionExactFailureCurrentV1(work: Promise<unknown>, expected: unknown): Promise<void> {
	const outcome = await work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
	assert.equal(outcome.failed, true); assert.equal(Object.is(outcome.error, expected), true);
}
