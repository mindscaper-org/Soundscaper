/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobReader, ZipReader } from '@zip.js/zip.js/index-native.js';
import { createScapeArchiveByteSource, createBlobScapeArchiveByteSource } from '../src/common/scape/archive-byte-source.ts';
import type { ScapeArchiveReader, ScapeArchiveReaderFactory } from '../src/common/editor/scape-archive-reader.ts';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { LightscaperNativePhotoSettingsCurrentV1 as Settings } from '../desktop/lightscaper-native-photo-settings-current-v1.ts';
import { LIGHTSCAPER_NATIVE_PHOTO_LIBRARY_SELECTION_KEY_CURRENT_V1 as POINTER,
	readLightscaperNativePhotoLibrarySelectionCurrentV1 as readPointer } from '../desktop/lightscaper-native-photo-library-selection-contract-current-v1.ts';
import { nativeRestoreArchiveCurrentV1 as archive, nativeArchiveRestoreTargetCurrentV1 as target } from './helpers/lightscaper-native-library-archive-restore-fixture-current.ts';
import { remainsPending } from './helpers/async-test-control.ts';

function reader(close: () => Promise<void>): ScapeArchiveReaderFactory {
	return (blob, signal) => {
		const zip = new ZipReader(new BlobReader(blob), { useWebWorkers: false, signal });
		return { getEntriesGenerator: options => zip.getEntriesGenerator(options) as unknown as ReturnType<ScapeArchiveReader['getEntriesGenerator']>,
			async close() { try { await close(); } finally { await zip.close(); } } };
	};
}

void test('Native archive manager shutdown joins a genuinely held input read and rejects duplicate archive IO', { timeout: 15_000 }, async context => {
	const source = await archive(context);
	await target(context, async f => {
		const entered = f.gate(), leave = f.gate(), bytes = createBlobScapeArchiveByteSource(source.blob);
		const input = createScapeArchiveByteSource({ size: bytes.size, async read(request) { entered.release(); await leave.promise; return bytes.read(request); } });
		const work = f.track(f.scopes.restoreArchive(input, { name: 'Native default', signal: f.signal }));
		const observed = work.then(() => false, () => true); await f.reached(entered.promise, work);
		let duplicateReads = 0;
		const duplicate = createScapeArchiveByteSource({ size: bytes.size, read(request) { duplicateReads++; return bytes.read(request); } });
		await assert.rejects(f.scopes.restoreArchive(duplicate, { name: 'Duplicate', signal: f.signal })); assert.equal(duplicateReads, 0);
		const close = f.track(f.scopes.close()); assert.equal(await remainsPending(close), true);
		await assert.rejects(Scopes.open({ appDataPath: f.directory })); leave.release(); assert.equal(await observed, true); await close;
	});
});

void test('Native archive preserves an opaque cancellation reason while joining a held actual input provider', { timeout: 15_000 }, async context => {
	const source = await archive(context);
	await target(context, async f => {
		const entered = f.gate(), leave = f.gate(), controller = new AbortController(), reason = Symbol('native archive cancellation');
		const bytes = createBlobScapeArchiveByteSource(source.blob);
		const input = createScapeArchiveByteSource({ size: bytes.size, async read(request) { entered.release(); await leave.promise; return bytes.read(request); } });
		const previous = await f.scopes.openSelected({ name: 'Native default' });
		const work = f.track(f.scopes.restoreArchive(input, { name: 'Native default', signal: controller.signal }));
		const observed = work.then(() => { throw new Error('Expected cancellation.'); }, (error: unknown) => error);
		await f.reached(entered.promise, work); controller.abort(reason); assert.equal(await remainsPending(observed), true); leave.release(); assert.equal(await observed, reason);
		assert.equal((await f.scopes.openSelected({ name: 'Unchanged' })).selectionToken, previous.selectionToken);
	});
});

void test('Native archive waits for actual ZIP reader close before publishing its complete generation', { timeout: 15_000 }, async context => {
	const source = await archive(context);
	await target(context, async f => {
		const entered = f.gate(), leave = f.gate(), previous = await f.scopes.openSelected({ name: 'Native default' });
		const anchor = await Settings.open({ appDataPath: f.directory, scope: 'anchor' });
		try {
			const work = f.track(f.scopes.restoreArchive(source.blob, { name: 'Native default', signal: f.signal,
				readerFactories: { blob: reader(async () => { entered.release(); await leave.promise; }) } }));
			await f.reached(entered.promise, work); assert.equal(await remainsPending(work), true);
			const entry = await anchor.readLibraryAnchorEntryCurrentV1(POINTER); assert.equal(entry.present, true);
			if (entry.present) assert.equal(readPointer(entry.value).selectionToken, previous.selectionToken);
			leave.release(); const result = await work; assert.equal(result.photoCount, 6);
			assert.notEqual((await f.scopes.openSelected({ name: 'Published' })).selectionToken, previous.selectionToken);
		} finally { leave.release(); await anchor.close(); }
	});
});

void test('Native archive reader-close failure preserves the pointer and retires the role for a later real restore', { timeout: 15_000 }, async context => {
	const source = await archive(context);
	await target(context, async f => {
		const previous = await f.scopes.openSelected({ name: 'Native default' }), failure = new Error('Actual ZIP reader close receipt failed.');
		await assert.rejects(f.track(f.scopes.restoreArchive(source.blob, { name: 'Native default', signal: f.signal,
			readerFactories: { blob: reader(async () => { throw failure; }) } })), error => error === failure);
		assert.equal((await f.scopes.openSelected({ name: 'Unchanged' })).selectionToken, previous.selectionToken);
		assert.equal((await f.track(f.scopes.restoreArchive(source.blob, { name: 'Later', signal: f.signal }))).photoCount, 6);
	});
});

void test('Native archive captures actual reader factory before lazy loading and later caller mutation', { timeout: 15_000 }, async context => {
	const source = await archive(context);
	await target(context, async f => {
		let originalCalls = 0, replacedCalls = 0;
		const actual = reader(async () => undefined), readers = { blob: ((...args) => { originalCalls++; return actual(...args); }) as ScapeArchiveReaderFactory };
		const work = f.track(f.scopes.restoreArchive(source.blob, { name: 'Native default', signal: f.signal, readerFactories: readers }));
		readers.blob = () => { replacedCalls++; throw new Error('Late factory must not replace the accepted owner.'); };
		assert.equal((await work).photoCount, 6); assert.equal(originalCalls, 1); assert.equal(replacedCalls, 0);
	});
});
