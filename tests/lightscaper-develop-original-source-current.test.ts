/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoLibraryDevelopOriginalSessionV1 } from '../src/lightscaper/controller/photo-library-develop-original-session-v1.ts';
import { createPhotoLibraryDevelopOriginalSessionV2 } from '../src/lightscaper/controller/photo-library-develop-original-session-v2.ts';
import { createPhotoLibraryDevelopOriginalSessionCurrentV1 } from '../src/lightscaper/controller/photo-library-develop-original-session-current-v1.ts';
import { createPhotoLibraryDevelopDerivedOriginalSessionCurrentV1 } from '../src/lightscaper/controller/photo-library-develop-derived-original-session-current-v1.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import { developOriginalSourceNativeFixtureCurrentV1 as fixture } from './helpers/lightscaper-develop-original-source-native-fixture-current.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type FixtureHost = Awaited<ReturnType<typeof fixture>>['host'];
const owners = [[1, (host: FixtureHost) => createPhotoLibraryDevelopOriginalSessionV1({ ...host,
	repository: { async loadPhoto() { return normalizePhotoDocumentV1(await host.repository.loadPhoto()); } } })],
	[2, (host: FixtureHost) => createPhotoLibraryDevelopOriginalSessionV2({ ...host,
		repository: { async loadPhoto() { return normalizePhotoDocumentV1OrV2(await host.repository.loadPhoto()); } } })],
	[3, (host: FixtureHost) => createPhotoLibraryDevelopOriginalSessionCurrentV1(host)]] as const;
async function reached(barrier: Promise<void>, work: Promise<unknown>): Promise<void> {
	await Promise.race([barrier, work.then(() => { throw new Error('Operation ended before the required ownership barrier.'); })]);
}
for (const [schema, create] of owners) test(`Photo${schema} canonical Develop source-only lease joins real RAW, consumer and decoder retirement`, { timeout: 15_000 }, async context => {
	const entered = deferred<void>(), consumed = deferred<void>(), retiring = deferred<void>(), retired = deferred<void>();
	const f = await fixture(schema, context.signal, () => { consumed.resolve(); retired.resolve(); });
	let work: Promise<unknown> | undefined;
	try {
		f.hooks.retireDecoder = async () => { retiring.resolve(); await retired.promise; };
		const port = create(f.host); work = port.withFrame(f.request(), async view => {
			assert.equal(view.frame.descriptor.sampleFormat, 'unorm16'); assert.ok(view.frame.pixels.some(value => value > 0));
			assert.equal(f.native.canonical.active(), 0); assert.equal(f.calls().closes, 0); entered.resolve(); await consumed.promise; return 'real native pixels';
		});
		void work.catch(() => undefined); await reached(entered.promise, work); assert.equal(await remainsPending(work), true); consumed.resolve();
		await reached(retiring.promise, work); assert.equal(f.native.canonical.statistics.joined, 1); assert.equal(f.calls().closes, 0);
		assert.equal(await remainsPending(work), true); retired.resolve(); assert.equal(await work, 'real native pixels');
		assert.deepEqual(f.calls(), { leases: 1, closes: 1, fallbacks: 0 });
	} finally { consumed.resolve(); retired.resolve(); await Promise.allSettled([work]); await f.close(); }
});

for (const profile of ['linear-headroom-v1', 'highlight-recovery-v1'] as const) test(`derived ${profile} source lease outlives real two-worker retirement and late revision fence`, { timeout: 15_000 }, async context => {
	const retiring = deferred<void>(), retired = deferred<void>();
	const f = await fixture(3, context.signal, () => { retired.resolve(); }); let work: Promise<unknown> | undefined;
	try {
		f.hooks.retireDecoder = async () => { retiring.resolve(); await retired.promise; };
		const port = createPhotoLibraryDevelopDerivedOriginalSessionCurrentV1(f.host);
		work = port.withDerivedFrame({ ...f.request(), profile }, async view => {
			assert.equal(view.profile, profile); assert.equal(view.frame.descriptor.sampleFormat, 'float32'); assert.ok(view.frame.pixels.some(value => value > 1));
			assert.equal(f.calls().closes, 0); assert.equal(f.native.canonical.active(), 0); assert.equal(f.native.recovery.active(), 0); return 'derived';
		});
		void work.catch(() => undefined); await reached(retiring.promise, work);
		assert.equal(f.native.canonical.statistics.joined, 1); assert.equal(f.native.recovery.statistics.joined, 1); assert.equal(f.calls().closes, 0);
		f.replace({ ...f.current(), revision: f.current().revision + 1 }); retired.resolve();
		await assert.rejects(work, PhotoCatalogRevisionConflictError); assert.equal(f.calls().closes, 1);
	} finally { retired.resolve(); await Promise.allSettled([work]); await f.close(); }
});

test('Current canonical decoder retains durable Web Blob fallback and scoped source precedence', { timeout: 15_000 }, async context => {
	for (const scoped of [false, true]) {
		const f = await fixture(3, context.signal); let work: Promise<unknown> | undefined;
		try {
			const host = { ...f.host, loadOriginal: f.loadOriginal };
			if (!scoped) Reflect.deleteProperty(host, 'originalSource');
			const port = createPhotoLibraryDevelopOriginalSessionCurrentV1(host);
			work = port.withFrame(f.request(), async view => view.frame.descriptor.sampleFormat);
			assert.equal(await work, 'unorm16'); assert.deepEqual(f.calls(), scoped ? { leases: 1, closes: 1, fallbacks: 0 } : { leases: 0, closes: 0, fallbacks: 1 });
		} finally { await Promise.allSettled([work]); await f.close(); }
	}
});

test('Current Develop stale admission opens no source, and held acquisition cancellation joins lease cleanup', { timeout: 15_000 }, async context => {
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const f = await fixture(3, context.signal, () => { release.resolve(); }); let work: Promise<unknown> | undefined;
	const reason = new Proxy({}, { get() { assert.fail('Opaque reason inspected.'); }, getPrototypeOf() { assert.fail('Opaque reason reflected.'); } });
	try {
		const port = createPhotoLibraryDevelopOriginalSessionCurrentV1(f.host);
		await assert.rejects(port.withFrame({ ...f.request(), expectedRevision: 1 }, async () => undefined), PhotoCatalogRevisionConflictError);
		assert.equal(f.calls().leases, 0);
		f.hooks.acquire = async () => { entered.resolve(); await release.promise; };
		work = port.withFrame(f.request(), async () => { assert.fail('Cancelled source reached decoder consumer.'); }, { signal: stop.signal });
		const outcome = work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
		await reached(entered.promise, work); stop.abort(reason); assert.equal(await remainsPending(work), true); release.resolve();
		assert.equal((await outcome).error, reason); assert.equal(f.calls().closes, 1); assert.equal(f.native.canonical.statistics.created, 0);
	} finally { release.resolve(); await Promise.allSettled([work]); await f.close(); }
});
