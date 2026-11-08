/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePhotoLibraryBackupSourceV1 } from '../src/lightscaper/controller/photo-library-backup-source-v1.ts';
import { capturePhotoLibraryBackupSourceV2 } from '../src/lightscaper/controller/photo-library-backup-source-v2.ts';
import { capturePhotoLibraryBackupSourceV3 } from '../src/lightscaper/controller/photo-library-backup-source-v3.ts';
import { capturePhotoLibraryBackupSourceCurrentV1 } from '../src/lightscaper/controller/photo-library-backup-source-current-v1.ts';
import { exportPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-export.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { exportPhotoCatalogArchiveV6 } from '../src/lightscaper/archive/catalog-archive-export-v6.ts';
import { exportPhotoCatalogArchiveV8 } from '../src/lightscaper/archive/catalog-archive-export-v8.ts';
import { scopedBackupFixtureCurrentV1 as fixture, assertScopedBackupRoundTripCurrentV1 as roundTrip } from './helpers/lightscaper-scoped-backup-fixture-current.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
const profiles = [
	['V1', false, async (f: Fixture, signal: AbortSignal) => {
		const source = await capturePhotoLibraryBackupSourceV1(f.photo.catalogId, { catalog: f.legacyCatalog, originalSource: f.source }, signal);
		assert.equal(f.calls().acquired, 0); f.source.acquire = async () => { assert.fail('Late source replacement was consulted.'); };
		return exportPhotoCatalogArchiveV1(source.initial.catalog, source.originals, { signal });
	}],
	['V2', false, async (f: Fixture, signal: AbortSignal) => {
		const source = await capturePhotoLibraryBackupSourceV2(f.photo.catalogId, { catalog: f.legacyCatalog, originalSource: f.source }, signal);
		assert.equal(f.calls().acquired, 0); f.source.acquire = async () => { assert.fail('Late source replacement was consulted.'); };
		return exportPhotoCatalogArchiveV5(source.initial.catalog, source.originals, [], null, [], null, undefined, { signal });
	}],
	['V3', false, async (f: Fixture, signal: AbortSignal) => {
		const source = await capturePhotoLibraryBackupSourceV3(f.photo.catalogId, { catalog: f.legacyCatalog, originalSource: f.source }, signal);
		assert.equal(f.calls().acquired, 0); f.source.acquire = async () => { assert.fail('Late source replacement was consulted.'); };
		return exportPhotoCatalogArchiveV6(source.initial.catalog, source.originals, [], null, [], null, undefined, undefined, { signal });
	}],
	['Current', true, async (f: Fixture, signal: AbortSignal) => {
		const source = await capturePhotoLibraryBackupSourceCurrentV1(f.photo.catalogId, { catalog: f.catalog, originalSource: f.source }, null, signal);
		assert.equal(source.requiresRawDevelopment, true); assert.equal(f.calls().acquired, 0);
		f.source.acquire = async () => { assert.fail('Late source replacement was consulted.'); };
		return exportPhotoCatalogArchiveV8(source.initial.catalog, source.originals, [], null, [], null, undefined, undefined, { signal });
	}],
] as const;
for (const [name, current, run] of profiles) test(`${name} backup scoped-only source stays lazy, pins receiver and roundtrips actual ZIP/File bytes`,
	{ timeout: 15_000 }, async context => {
	const f = await fixture(current); let work: ReturnType<typeof run> | undefined;
	try {
		context.signal.throwIfAborted(); work = run(f, context.signal); const result = await work;
		assert.ok(result.blob); assert.equal(result.document.schemaVersion, name === 'V1' ? 1 : name === 'V2' ? 5 : name === 'V3' ? 6 : 8);
		assert.deepEqual(f.calls(), { acquired: 1, closed: 1, fallbacks: 0 });
		await roundTrip(result.blob, f, result.document.schemaVersion);
	} finally { await Promise.allSettled([work]); await f.close(); }
});

test('backup generators preserve genuine Web fallback and scoped-source precedence without touching fallback', { timeout: 15_000 }, async context => {
	for (const scoped of [false, true]) {
		const f = await fixture(); let iterator: AsyncIterator<unknown> | undefined;
		try {
			context.signal.throwIfAborted();
			const ports = scoped ? f.legacyPorts : { catalog: f.legacyCatalog, loadOriginal: f.legacyPorts.loadOriginal.bind(f.legacyPorts) };
			const source = await capturePhotoLibraryBackupSourceV2(f.photo.catalogId, ports, context.signal);
			iterator = source.originals[Symbol.asyncIterator](); const next = await iterator.next(); assert.equal(next.done, false);
			assert.equal(f.calls().closed, 0); await iterator.return?.();
			assert.deepEqual(f.calls(), scoped ? { acquired: 1, closed: 1, fallbacks: 0 } : { acquired: 0, closed: 0, fallbacks: 1 });
		} finally { await iterator?.return?.(); await f.close(); }
	}
});

test('backup generator return waits exact lease cleanup and retains its opaque rejection reason', { timeout: 15_000 }, async context => {
	const f = await fixture(); let iterator: AsyncIterator<unknown> | undefined;
	const reason = new Proxy({}, { get() { assert.fail('Opaque cleanup reason inspected.'); }, getPrototypeOf() { assert.fail('Opaque cleanup reason reflected.'); } });
	try {
		f.failClose(reason); const source = await capturePhotoLibraryBackupSourceV3(f.photo.catalogId,
			{ catalog: f.legacyCatalog, originalSource: f.source }, context.signal);
		iterator = source.originals[Symbol.asyncIterator](); assert.equal((await iterator.next()).done, false);
		let refused = false; await iterator.return?.().then(() => undefined, (error: unknown) => { refused = true; assert.equal(error, reason); });
		assert.equal(refused, true); assert.equal(f.calls().closed, 1);
	} finally { await Promise.allSettled([iterator?.return?.()]); await f.close(); }
});
