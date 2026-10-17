/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createLightscaperFileSaveServiceCurrentV1, type LightscaperFileSaveScopeCurrentV1 } from '../src/lightscaper/photo-file-save-service-current-v1.ts';
import { createPhotoLibraryBackupSaveRuntimeV1 } from '../src/lightscaper/photo-library-backup-save-runtime.ts';
import { PhotoLibraryBackupSaveV1 } from '../src/common/editor/controller/shared/photo-library-backup-save-v1.ts';
import { PhotoRasterExportCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-current-v1.ts';
import type { PhotoRasterExportRequestCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-contract-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';
import { repairRasterFixture, decodePng } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';

function deliveryFixture(desktop: boolean) {
	const picked: unknown[] = [], clicked: string[] = [], blobs: Blob[] = [], writes: Uint8Array[] = [], revoked: string[] = [];
	const committed: Readonly<{ name: string; bytes: Uint8Array }>[] = [];
	const timers: (() => void)[] = []; let pickerReads = 0, closes = 0, environmentReads = 0;
	const scope: LightscaperFileSaveScopeCurrentV1 = {
		...(desktop ? { lightscaperDesktop: Object.freeze({ v1: Object.freeze({ getEnvironment: () => {
			environmentReads++; return Promise.resolve({ productId: 'lightscaper' });
		} }) }) } : {}),
		get showSaveFilePicker() {
			pickerReads++;
			return function (this: unknown, request: Readonly<{ suggestedName: string }>) {
				assert.equal(this, scope); picked.push(request);
				return Promise.resolve({ name: request.suggestedName, createWritable: async () => {
					let body = new Uint8Array(0), position = 0;
					return { write: async (value: unknown) => {
						let bytes: Uint8Array, offset = position;
						if (value instanceof Blob) bytes = new Uint8Array(await value.arrayBuffer());
						else if (value instanceof Uint8Array) bytes = value;
						else {
							assert.ok(value !== null && typeof value === 'object' && 'type' in value && 'position' in value && 'data' in value);
							assert.equal(value.type, 'write'); assert.equal(typeof value.position, 'number');
							assert.ok(value.data instanceof Uint8Array); offset = value.position as number; bytes = value.data;
						}
						assert.ok(Number.isSafeInteger(offset) && offset >= 0);
						const next = new Uint8Array(Math.max(body.length, offset + bytes.length));
						next.set(body); next.set(bytes, offset); body = next; position = offset + bytes.length; writes.push(bytes.slice());
					}, close: () => { closes++; committed.push({ name: request.suggestedName, bytes: body }); }, abort: () => undefined };
				} });
			};
		},
	};
	const options = { scope, document: { createElement: () => ({ href: '', download: '', hidden: false,
		click() { clicked.push(this.download); }, remove: () => undefined }) },
		urlApi: { createObjectURL(blob: Blob) { blobs.push(blob); return `blob:lightscaper-app://bundle/00000000-0000-4000-8000-${String(blobs.length).padStart(12, '0')}`; },
			revokeObjectURL(url: string) { revoked.push(url); } },
		setTimeout(callback: () => void, delay: number) { assert.equal(delay, 30_000); timers.push(callback); },
	};
	return { scope, options, picked, clicked, blobs, writes, revoked, committed, timers,
		counts: () => ({ pickerReads, closes, environmentReads }) };
}

test('Light desktop save chooses the real blob-download backend even when a native FSA picker exists', async () => {
	const f = deliveryFixture(true), service = createLightscaperFileSaveServiceCurrentV1(f.options);
	const request = Object.freeze({ purpose: 'media', suggestedName: 'Photo.png', mimeType: 'image/png', useFileSystemAccess: true });
	const prepared = await service.prepareSave(request);
	assert.equal(prepared.mode, 'blob'); assert.equal(f.counts().pickerReads, 0); assert.equal(f.counts().environmentReads, 0);
	if (prepared.mode !== 'blob') throw new Error('The desktop requires an ordinary blob download target.');
	assert.deepEqual(prepared.target, { name: 'Photo.png', browserDownload: true });
	const saved = await service.saveFile({ ...request, target: prepared.target, blob: new Blob(['PNG'], { type: 'image/png' }) });
	assert.deepEqual(saved, { method: 'download', fileName: 'Photo.png', size: 3 }); assert.deepEqual(f.clicked, ['Photo.png']);
	assert.equal(await f.blobs[0]!.text(), 'PNG'); assert.equal(request.useFileSystemAccess, true);
	assert.equal(f.counts().pickerReads, 0); assert.deepEqual(f.revoked, []); f.timers[0]!(); assert.equal(f.revoked.length, 1);
});

test('ordinary Light browser keeps its activating-turn FSA picker and exact staged stream commit', async () => {
	const f = deliveryFixture(false), service = createLightscaperFileSaveServiceCurrentV1(f.options);
	const pending = service.prepareSave({ purpose: 'project', suggestedName: 'Catalog.liscape', useFileSystemAccess: true });
	assert.equal(f.picked.length, 1, 'Browser picker retains the original Save activation.');
	const prepared = await pending; assert.equal(prepared.mode, 'stream');
	if (prepared.mode !== 'stream') throw new Error('Browser FSA must preserve its staged destination.');
	const output = await prepared.createWritable(3, 'exact'), writer = output.getWriter();
	try { await writer.write(Uint8Array.of(1, 2, 3)); await writer.close(); } finally { writer.releaseLock(); }
	assert.equal(f.counts().closes, 0); assert.deepEqual(await prepared.commit(), { method: 'file-system-access', fileName: 'Catalog.liscape', size: 3 });
	assert.equal(f.counts().closes, 1); assert.deepEqual(f.writes, [Uint8Array.of(1, 2, 3)]); assert.deepEqual(f.clicked, []);
	assert.deepEqual(f.committed, [{ name: 'Catalog.liscape', bytes: Uint8Array.of(1, 2, 3) }]);
});

test('generic Sound and Frame bridge names cannot select Lightscaper desktop delivery', async () => {
	const f = deliveryFixture(false);
	Object.assign(f.scope, { scapeDesktop: { v1: { getEnvironment: () => Promise.resolve({ productId: 'soundscaper' }) } },
		framescaperDesktop: { v1: { getEnvironment: () => Promise.resolve({ productId: 'framescaper' }) } } });
	const service = createLightscaperFileSaveServiceCurrentV1(f.options);
	const prepared = await service.prepareSave({ purpose: 'media', suggestedName: 'Photo.png', useFileSystemAccess: true });
	assert.equal(prepared.mode, 'stream'); assert.equal(f.picked.length, 1); if (prepared.mode === 'stream') await prepared.abort();
});

test('one Light save runtime pins its backend across bridge removal without editing the host picker', async () => {
	const f = deliveryFixture(true), descriptor = Object.getOwnPropertyDescriptor(f.scope, 'showSaveFilePicker');
	const service = createLightscaperFileSaveServiceCurrentV1(f.options); Reflect.deleteProperty(f.scope, 'lightscaperDesktop');
	assert.equal((await service.prepareSave({ purpose: 'project', suggestedName: 'Catalog.liscape', useFileSystemAccess: true })).mode, 'blob');
	const saved = await service.saveFile({ purpose: 'media', suggestedName: 'Photo.png', useFileSystemAccess: true, bytes: 'PNG' });
	if ('cancelled' in saved) throw new Error('The desktop download was unexpectedly cancelled.');
	assert.equal(saved.method, 'download');
	assert.deepEqual(Object.getOwnPropertyDescriptor(f.scope, 'showSaveFilePicker'), descriptor); assert.equal(f.counts().pickerReads, 0);
});

test('desktop delivery preserves pre-aborted cancellation and an explicitly cancelled target', async () => {
	const f = deliveryFixture(true), service = createLightscaperFileSaveServiceCurrentV1(f.options), stop = new AbortController();
	const reason = Object.freeze({ opaque: 'cancel' }); stop.abort(reason);
	for (const method of ['prepareSave', 'saveFile'] as const) {
		const result = await service[method]({ purpose: 'media', suggestedName: 'Photo.png', useFileSystemAccess: true, signal: stop.signal })
			.then(value => ({ ok: true, value }), (error: unknown) => ({ ok: false, error }));
		assert.equal(result.ok, false); assert.ok('error' in result && Object.is(result.error, reason));
	}
	assert.deepEqual(await service.prepareSave({ purpose: 'media', suggestedName: 'Photo.png', target: null, useFileSystemAccess: true }),
		{ mode: 'cancelled', cancelled: true, fileName: 'Photo.png' });
	assert.deepEqual(await service.saveFile({ purpose: 'media', suggestedName: 'Photo.png', target: null, bytes: 'PNG' }),
		{ cancelled: true, fileName: 'Photo.png', size: 3 });
	assert.deepEqual(f.clicked, []); assert.equal(f.counts().pickerReads, 0);
});

test('ordinary browser picker dismissal remains cancellation rather than switching to a download', async () => {
	const f = deliveryFixture(false);
	Object.defineProperty(f.scope, 'showSaveFilePicker', { configurable: true,
		value: () => Promise.reject(new DOMException('Dismissed', 'AbortError')) });
	const service = createLightscaperFileSaveServiceCurrentV1(f.options);
	assert.deepEqual(await service.prepareSave({ purpose: 'project', suggestedName: 'Catalog.liscape', useFileSystemAccess: true }),
		{ mode: 'cancelled', cancelled: true, fileName: 'Catalog.liscape' });
	assert.deepEqual(f.clicked, []);
});

for (const desktop of [false, true]) test(`${desktop ? 'desktop' : 'browser'}: actual Current PNG and catalog backup share the one Light save factory`, async () => {
	const f = deliveryFixture(desktop), native = await repairRasterFixture();
	const runtime = createPhotoLibraryBackupSaveRuntimeV1(f.options), raster = new PhotoRasterExportCurrentV1('png'), backup = new PhotoLibraryBackupSaveV1();
	const prepares: string[] = [], render = createPhotoDevelopRenderRuntimeCurrentV1({ source: native.session.cubeLuts.source, maskSource: native.session.maskRasterSource });
	const request: PhotoRasterExportRequestCurrentV1 = { ...native.request(), loadRenderer: async () => render,
		encode: (frame, { bitDepth, ...options }) => { assert.ok(bitDepth === undefined || bitDepth === 8); return encodePixelFramePngV1(frame, options); },
		prepareSave: value => { assert.equal(value.useFileSystemAccess, true); prepares.push(String(value.purpose)); return runtime.prepareSave(value); },
		saveFile: runtime.saveFile };
	try {
		const before = await native.inspect();
		const image = await raster.start(request);
		if (image.status === 'cancelled') throw new Error('The actual Current PNG was unexpectedly cancelled.');
		assert.equal(image.status, desktop ? 'download-started' : 'saved'); assert.equal(image.method, desktop ? 'download' : 'file-system-access');
		const png = desktop ? new Uint8Array(await f.blobs[0]!.arrayBuffer()) : f.committed[0]!.bytes;
		assert.deepEqual([...decodePng(png).pixels], [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255]);
		const archive = await backup.start({ catalogName: 'Desktop library', fileTypeDescription: 'Lightscaper catalog',
			maximumStreamingBytes: runtime.maximumStreamingBytes,
			prepareSave: value => { assert.equal(value.useFileSystemAccess, true); prepares.push(String(value.purpose)); return runtime.prepareSave(value); },
			saveFile: runtime.saveFile, backupCatalog: options => native.session.backupCatalog(options) });
		if (archive.status === 'cancelled') throw new Error('The actual catalog backup was unexpectedly cancelled.');
		assert.equal(archive.status, desktop ? 'download-started' : 'saved'); assert.equal(archive.method, desktop ? 'download' : 'file-system-access');
		assert.deepEqual(prepares, ['media', 'project']);
		const archiveBytes = desktop ? new Uint8Array(await f.blobs[1]!.arrayBuffer()) : f.committed[1]!.bytes;
		assert.equal(archive.byteLength, archiveBytes.length); assert.deepEqual([...archiveBytes.slice(0, 4)], [80, 75, 3, 4]);
		if (desktop) {
			assert.deepEqual(f.clicked, ['Photo-1.png', 'Desktop library.liscape']); assert.equal(f.counts().pickerReads, 0);
			assert.equal(f.blobs.length, 2);
		} else { assert.equal(f.picked.length, 2); assert.equal(f.counts().closes, 2); assert.deepEqual(f.clicked, []); }
		assert.deepEqual(await native.inspect(), before);
	} finally { await Promise.all([raster.cancelAndJoin(), backup.cancelAndJoin()]); await native.close(); }
});
