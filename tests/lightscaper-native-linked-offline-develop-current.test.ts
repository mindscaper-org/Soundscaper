/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { getDesktopPhotoDevelopAvailabilityCurrentV1 as availability } from '../src/lightscaper/desktop-photo-develop-availability-current-v1.ts';
import { capturePhotoLibraryDevelopPortCurrentV1 as capture } from '../src/common/editor/ui/lightscaper/photo-library-workflow-develop-current-v1.ts';
import { PhotoLibraryDevelopPresentationCurrentV1 as Presentation } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 as renderRuntime } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { offlineLinkedDevelopFixtureCurrentV1 as fixture, holdOfflineDevelopInspectionCurrentV1 as hold, options, hash, remainsPending } from './helpers/lightscaper-native-linked-offline-develop-fixture-current.ts';

void test('Genuine selected linked availability distinguishes present/missing and exact relink without changing Photo authority', options, async context => fixture(context, async f => {
	assert.deepEqual(await f.source.read({ photoId: f.photoId, expectedRevision: f.revision }), { quality: 'original', locatorRevision: 0 });
	const moved = join(f.rootPath, 'Relinked actual.DNG'); await rename(f.file.file, moved);
	assert.deepEqual(await f.source.read({ photoId: f.photoId, expectedRevision: f.revision }), { quality: 'preview-derivative', locatorRevision: 0 });
	const row = (await f.runtime.readOriginalsPage()).rows.find(row => row.photoId === f.photoId); assert.ok(row);
	const selected = await f.select(f.runtime, 'Relinked actual.DNG');
	try { await f.runtime.relinkEntry({ scan: selected.scan, entryId: selected.entry.entryId }, row.binding, row.locatorRevision); }
	finally { await f.runtime.closeScan(selected.scan); }
	assert.deepEqual(await f.source.read({ photoId: f.photoId, expectedRevision: f.revision }), { quality: 'original', locatorRevision: 1 });
	const stored = await f.catalog.loadPhoto(f.catalogId, f.photoId); assert.ok(stored); assert.equal(stored.revision, f.revision); assert.deepEqual(stored.original, f.photo.original);
}));
void test('Automatic offline classification renders real cached bytes through Current presentation and full Original output still refuses', options, async context => fixture(context, async f => {
	await rename(f.file.file, join(f.rootPath, 'Disconnected.DNG'));
	const selected = await f.source.read({ photoId: f.photoId, expectedRevision: f.revision }); assert.equal(selected.quality, 'preview-derivative');
	const document = await f.session.develop.read({ schemaVersion: 3, photoId: f.photoId });
	const before = {} as HTMLCanvasElement, after = {} as HTMLCanvasElement, painted = new Map<HTMLCanvasElement, string>();
	let openedOriginal = 0;
	const owner = new Presentation({ readPreview: f.session.readPreview.bind(f.session),
		withOriginalFrame: async (...args) => { openedOriginal++; const original = f.session.develop.original; assert.ok(original); return original.withFrame(...args); },
		loadProxy: async () => renderRuntime({ source: f.session.cubeLuts.source, maskSource: f.session.maskRasterSource }),
		paint: (canvas, frame) => { painted.set(canvas, hash(new Uint8Array(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength))); return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; },
		clear: canvas => { painted.delete(canvas); } });
	try { owner.setView({ photoId: f.photoId, revision: f.revision, develop: document.develop, before, after, resolution: 'proxy', inputQuality: selected.quality });
		await owner.drain(); assert.equal(owner.snapshot().status, 'ready'); assert.equal(openedOriginal, 0);
		assert.equal(f.cached.outcome, 'ready'); assert.equal(painted.get(before), f.cached.preview.outputSha256); assert.ok(painted.has(after));
		const original = f.session.develop.original; assert.ok(original);
		await assert.rejects(original.withFrame({ schemaVersion: 1, photoId: f.photoId, expectedRevision: f.revision }, () => undefined));
	} finally { await owner.close(); }
}));
void test('Corrupt linked bytes remain a hard failure; only genuine revoked/missing classifications select preview', options, async context => fixture(context, async f => {
	const altered = f.file.bytes.slice(); altered[altered.length - 1] = altered[altered.length - 1]! ^ 1;
	try { await writeFile(f.file.file, altered); await assert.rejects(f.source.read({ photoId: f.photoId, expectedRevision: f.revision })); }
	finally { altered.fill(0); }
	await writeFile(f.file.file, f.file.bytes); const row = (await f.runtime.readOriginalsPage()).rows[0]; assert.ok(row);
	await f.runtime.revoke(row.grantId);
	assert.deepEqual(await f.source.read({ photoId: f.photoId, expectedRevision: f.revision }), { quality: 'preview-derivative', locatorRevision: 0 });
}));
void test('Managed Originals stay original-quality and stale Photo revisions never grant offline fallback', options, async context => fixture(context, async f => {
	const items = await f.session.importFiles([new File([f.file.bytes], 'Managed actual.DNG', { type: 'image/x-adobe-dng' })]);
	const id = items[0]?.photoId; assert.ok(id); const photo = await f.catalog.loadPhoto(f.catalogId, id); assert.ok(photo); assert.equal(photo.original.retention, 'managed');
	assert.deepEqual(await f.source.read({ photoId: id, expectedRevision: photo.revision }), { quality: 'original', locatorRevision: null });
	await f.session.applyAttributes(f.photoId, { rating: 3 });
	await assert.rejects(f.source.read({ photoId: f.photoId, expectedRevision: f.revision }));
}));
void test('Private availability aliases survive actual captured Current ports without accepting forged Session-shaped objects', options, async context => fixture(context, async f => {
	let reflected = 0; const forged = new Proxy({}, { get() { reflected++; throw new Error('Forged source reflected.'); }, ownKeys() { reflected++; return []; } });
	assert.equal(availability(forged), null); assert.equal(reflected, 0);
	const execute = () => undefined, port = capture(f.session.develop, undefined, execute);
	assert.equal(availability(port), f.source); assert.equal(availability(execute), f.source);
}));
void test('Session close joins accepted genuine availability receipts before retiring native ownership', options, async context => fixture(context, async f => {
	const gate = hold(context), reading = f.track(f.source.read({ photoId: f.photoId, expectedRevision: f.revision })); let closing: Promise<void> | undefined;
	try { await gate.entered; assert.equal(gate.observed, true); closing = f.session.close(); assert.equal(await remainsPending(closing), true);
		gate.release(); await Promise.allSettled([reading]); await closing;
		let reflected = 0; const poison = new Proxy({}, { ownKeys() { reflected++; throw new Error('Post-close request reflected.'); } });
		await assert.rejects(f.source.read(poison as { photoId: string; expectedRevision: number })); assert.equal(reflected, 0);
	} finally { gate.release(); await Promise.allSettled([reading, ...(closing ? [closing] : [])]); gate.restore(); }
}));
