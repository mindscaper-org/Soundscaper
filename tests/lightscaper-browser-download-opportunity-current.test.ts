/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setImmediate as nextTask } from 'node:timers/promises';
import test from 'node:test';
import { createLightscaperFileSaveServiceCurrentV1, type LightscaperFileSaveScopeCurrentV1 } from '../src/lightscaper/photo-file-save-service-current-v1.ts';
import { PhotoRasterExportCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-current-v1.ts';
import type { PhotoRasterExportRequestCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-contract-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';
import { repairRasterFixture } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

/** Native EventTarget and AbortSignal with an explicitly driven presentation
 * boundary. No clock delay stands in for the browser's frame callback. */
class PresentationDocument extends EventTarget {
	#visibility: DocumentVisibilityState;
	readonly clicked: string[] = [];
	constructor(hidden: boolean, readonly onClick?: () => void) { super(); this.#visibility = hidden ? 'hidden' : 'visible'; }
	get visibilityState(): DocumentVisibilityState { return this.#visibility; }
	visibility(hidden: boolean): void { this.#visibility = hidden ? 'hidden' : 'visible'; this.dispatchEvent(new Event('visibilitychange')); }
	createElement(_tag: 'a') {
		const publish = (name: string) => { this.clicked.push(name); this.onClick?.(); };
		return { href: '', download: '', hidden: false, click() { publish(this.download); }, remove() {} };
	}
	readonly body = { append: () => undefined };
}

function fixture({ hidden = false, desktop = false, presentation = true, onClick, frameFailure, frameFailureAt = 1 }: {
	hidden?: boolean; desktop?: boolean; presentation?: boolean; onClick?: () => void; frameFailure?: unknown; frameFailureAt?: number;
} = {}) {
	const document = new PresentationDocument(hidden, onClick), frames = new Map<number, FrameRequestCallback>(), cancelled: number[] = [];
	const timers: (() => void)[] = [], writes: Blob[] = []; let ordinal = 0, urls = 0, pickers = 0;
	const scope: LightscaperFileSaveScopeCurrentV1 & {
		requestAnimationFrame?: (callback: FrameRequestCallback) => number;
		cancelAnimationFrame?: (handle: number) => void;
	} = { document,
		...(presentation ? { requestAnimationFrame(callback: FrameRequestCallback) { assert.equal(this, scope);
			const id = ++ordinal; if (frameFailure !== undefined && id === frameFailureAt) throw frameFailure; frames.set(id, callback); return id; },
			cancelAnimationFrame(id: number) { assert.equal(this, scope); cancelled.push(id); frames.delete(id); } } : {}),
		...(desktop ? { lightscaperDesktop: { v1: { getEnvironment() { assert.fail('Backend admission must not invoke its environment reader.'); } } } } : {}),
		showSaveFilePicker() {
			assert.equal(this, scope); pickers++;
			return Promise.resolve({ name: 'Chosen.png', createWritable: () => Promise.resolve({
				write: (value: unknown) => { assert.ok(value instanceof Blob); writes.push(value); }, close: () => undefined, abort: () => undefined,
			}) });
		},
	};
	const service = createLightscaperFileSaveServiceCurrentV1({ scope,
		urlApi: { createObjectURL: () => `blob:photo-${++urls}`, revokeObjectURL: () => undefined },
		setTimeout(callback, delay) { assert.equal(delay, 30_000, 'Only the existing Blob-URL retirement timer is permitted.'); timers.push(callback); },
	});
	return { service, scope, document, frames, cancelled, timers, writes, pickers: () => pickers,
		frame() { assert.equal(frames.size, 1); const [id, callback] = [...frames.entries()][0]!; frames.delete(id); callback(0); },
		clean(signal?: AbortSignal) { assert.equal(frames.size, 0); assert.equal(getEventListeners(document, 'visibilitychange').length, 0);
			if (signal) assert.equal(getEventListeners(signal, 'abort').length, 0); } };
}
const request = (name: string, signal?: AbortSignal) => ({ purpose: 'media', suggestedName: name,
	target: { browserDownload: true, name }, mimeType: name.endsWith('.json') ? 'application/json' : 'image/png', blob: new Blob(['PNG']), signal });

test('Light browser paired JSON brackets its actual request with presentation opportunities', async () => {
	const f = fixture(), stop = new AbortController();
	const work = (async () => {
		const image = await f.service.saveFile(request('Photo.png', stop.signal));
		const json = await f.service.saveFile(request('Photo.png.lightscaper.json', stop.signal)); return { image, json };
	})();
	const joined = work.then(() => undefined, () => undefined);
	try {
		await nextTask(); assert.deepEqual(f.document.clicked, ['Photo.png']); assert.equal(f.frames.size, 1);
		f.frame(); await nextTask(); assert.deepEqual(f.document.clicked, ['Photo.png', 'Photo.png.lightscaper.json']); assert.equal(f.frames.size, 1);
		f.frame(); assert.deepEqual(await work, {
			image: { method: 'download', fileName: 'Photo.png', size: 3 },
			json: { method: 'download', fileName: 'Photo.png.lightscaper.json', size: 3 },
		});
		assert.equal(f.timers.length, 2); f.clean(stop.signal);
	} finally { stop.abort(); await joined; }
});

test('Light browser retirement after its JSON click releases the held frame and preserves that irreversible receipt', async () => {
	const f = fixture(), stop = new AbortController(), reason = Object.freeze({ retired: 'after native anchor click' });
	const name = 'Photo.png.lightscaper.json', work = f.service.saveFile(request(name, stop.signal)), joined = work.then(() => undefined, () => undefined);
	try {
		await nextTask(); assert.equal(f.frames.size, 1); assert.deepEqual(f.document.clicked, []); f.frame();
		await nextTask(); assert.equal(f.frames.size, 1); assert.equal(getEventListeners(stop.signal, 'abort').length, 1);
		stop.abort(reason); assert.deepEqual(await work, { method: 'download', fileName: name, size: 3 });
		assert.deepEqual(f.document.clicked, [name]); assert.deepEqual(f.cancelled, [2]); f.clean(stop.signal);
	} finally { stop.abort(); await joined; }
});

test('Light browser hidden JSON delivery refuses before its anchor with no pending frame, listener or timer', async () => {
	const f = fixture({ hidden: true }), stop = new AbortController();
	await assert.rejects(f.service.saveFile(request('Photo.png.lightscaper.json', stop.signal)), /visible presentation opportunity/u);
	assert.deepEqual(f.document.clicked, []); assert.equal(f.timers.length, 0); f.clean(stop.signal);
});

test('Light browser hide cancels the pre-JSON opportunity and later visibility cannot resume a refused delivery', async () => {
	const f = fixture(), stop = new AbortController();
	const name = 'Photo.png.lightscaper.json', work = f.service.saveFile(request(name, stop.signal));
	const joined = work.then(() => undefined, () => undefined);
	try {
		await nextTask(); assert.equal(f.frames.size, 1); f.document.visibility(true);
		await assert.rejects(work, /visible presentation opportunity/u); assert.deepEqual(f.cancelled, [1]);
		f.document.visibility(false); assert.deepEqual(f.document.clicked, []); f.clean(stop.signal);
	} finally { stop.abort(); await joined; }
});

test('Light browser cancellation inside the real JSON anchor preserves its receipt without scheduling a later frame', async () => {
	const stop = new AbortController(), f = fixture({ onClick: () => { stop.abort(Object.freeze({ nativeClick: 'already entered' })); } });
	const name = 'Photo.png.lightscaper.json', work = f.service.saveFile(request(name, stop.signal));
	await nextTask(); f.frame(); assert.deepEqual(await work, { method: 'download', fileName: name, size: 3 });
	assert.deepEqual(f.document.clicked, [name]); assert.deepEqual(f.cancelled, []); f.clean(stop.signal);
});

test('Light browser scheduling refusal before JSON releases all listeners and never requests the companion', async () => {
	const f = fixture({ frameFailure: new Error('The native presentation scheduler is unavailable.') }), stop = new AbortController();
	const name = 'Photo.png.lightscaper.json';
	await assert.rejects(f.service.saveFile(request(name, stop.signal)), /visible presentation opportunity/u);
	assert.deepEqual(f.document.clicked, []); assert.deepEqual(f.cancelled, []); f.clean(stop.signal);
});

test('Light browser scheduling refusal after JSON preserves its original irreversible receipt and releases listeners', async () => {
	const f = fixture({ frameFailure: new Error('The native presentation scheduler is unavailable.'), frameFailureAt: 2 }), stop = new AbortController();
	const name = 'Photo.png.lightscaper.json', work = f.service.saveFile(request(name, stop.signal));
	await nextTask(); f.frame(); assert.deepEqual(await work, { method: 'download', fileName: name, size: 3 });
	assert.deepEqual(f.document.clicked, [name]); assert.deepEqual(f.cancelled, []); f.clean(stop.signal);
});

test('Light browser preserves the activating-turn FSA picker and direct writes without presentation scheduling', async () => {
	const f = fixture(), pending = f.service.prepareSave({ purpose: 'media', suggestedName: 'Photo.png', useFileSystemAccess: true });
	assert.equal(f.pickers(), 1, 'The original activation reaches the picker before the first await.');
	const prepared = await pending; assert.equal(prepared.mode, 'stream');
	if (prepared.mode !== 'stream') throw new Error('The actual staged FSA path is required.');
	await prepared.abort();
	const target = await f.scope.showSaveFilePicker!({ suggestedName: 'Photo.png', excludeAcceptAllOption: false });
	assert.deepEqual(await f.service.saveFile({ purpose: 'media', target, blob: new Blob(['PNG']) }),
		{ method: 'file-system-access', fileName: 'Chosen.png', size: 3 });
	assert.equal(await f.writes[0]!.text(), 'PNG'); assert.deepEqual(f.document.clicked, []); f.clean();
});

test('Light desktop native download dialogs retain their existing delivery path even when browser presentation APIs exist', async () => {
	const f = fixture({ desktop: true, hidden: true });
	assert.deepEqual(await f.service.saveFile(request('Photo.png')), { method: 'download', fileName: 'Photo.png', size: 3 });
	assert.deepEqual(f.document.clicked, ['Photo.png']); assert.deepEqual(f.cancelled, []); f.clean();
});

test('Light non-browser hosts and cancelled or Blob-only destinations acquire no presentation owner', async () => {
	const f = fixture({ presentation: false });
	assert.deepEqual(await f.service.saveFile(request('Photo.png')), { method: 'download', fileName: 'Photo.png', size: 3 }); f.clean();
	const presented = fixture();
	assert.deepEqual(await presented.service.saveFile({ ...request('Photo.png'), target: null }), { cancelled: true, fileName: 'Photo.png', size: 3 });
	presented.clean(); assert.deepEqual(presented.document.clicked, []);
	const blobOnly = createLightscaperFileSaveServiceCurrentV1({ scope: presented.scope, document: null });
	const result = await blobOnly.saveFile(request('Photo.png'));
	assert.ok('method' in result && result.method === 'blob'); assert.equal(result.blob?.size, 3); presented.clean();
});

test('actual Current raster controller joins hidden presentation cancellation after image ACK and before JSON delivery', { timeout: 10_000 }, async () => {
	const native = await repairRasterFixture(), f = fixture(), raster = new PhotoRasterExportCurrentV1('png');
	const reason = Object.freeze({ close: 'hidden sidecar presentation' }), before = await native.inspect();
	const work = raster.start(actualRequest(native, f)), joined = work.then(() => undefined, () => undefined);
	try {
		await waitFor(() => f.frames.size === 1, 'the sidecar presentation after the actual Current image ACK');
		f.document.visibility(true); let retired = false;
		const closing = raster.cancelAndJoin(reason).then(() => { retired = true; });
		await settle(); assert.equal(retired, true, 'Close must join while hidden; the image commit shield cannot own the presentation wait.');
		await closing; const result = await work; assert.ok(result.status !== 'cancelled');
		assert.equal(result.status, 'download-started'); assert.equal(result.sidecar?.status, 'cancelled');
		assert.ok(result.sidecar?.status === 'cancelled' && result.sidecar.cause === reason);
		assert.deepEqual(f.document.clicked, ['Photo-1.png']); f.clean(); assert.equal(raster.isPending(), false);
		assert.deepEqual(await native.inspect(), before);
	} finally {
		// The RED implementation holds the image inside its commit shield. Make
		// that frame runnable before joining, so this regression never leaks it.
		f.document.visibility(false); if (f.frames.size) f.frame(); await settle();
		await raster.cancelAndJoin(reason); await joined; await native.close();
	}
});

test('actual Current cancellation during shielded image save joins after hidden sidecar refusal without a second cancel', { timeout: 10_000 }, async () => {
	const native = await repairRasterFixture(), f = fixture(), raster = new PhotoRasterExportCurrentV1('png');
	const entered = deferred<void>(), release = deferred<void>(), reason = Object.freeze({ close: 'inside image save shield' });
	const original = actualRequest(native, f), before = await native.inspect();
	const work = raster.start({ ...original, saveFile: async value => {
		const saved = await original.saveFile(value);
		if (value.mimeType === 'image/png') { entered.resolve(); await release.promise; } return saved;
	} }), joined = work.then(() => undefined, () => undefined);
	try {
		await entered.promise; let retired = false; const closing = raster.cancelAndJoin(reason).then(() => { retired = true; });
		await settle(); assert.equal(retired, false, 'The actual image commit remains shielded until its save joins.');
		f.document.visibility(true); release.resolve(); await closing;
		const result = await work; assert.ok(result.status !== 'cancelled'); assert.equal(result.status, 'download-started');
		assert.equal(result.sidecar?.status, 'failed'); assert.deepEqual(f.document.clicked, ['Photo-1.png']); f.clean();
		assert.equal(raster.isPending(), false); assert.deepEqual(await native.inspect(), before);
	} finally { release.resolve(); await raster.cancelAndJoin(reason); await joined; await native.close(); }
});

test('actual Current JSON-only retry follows hidden refusal without another image render or download', { timeout: 10_000 }, async () => {
	const native = await repairRasterFixture(), f = fixture({ hidden: true }), raster = new PhotoRasterExportCurrentV1('png');
	try {
		const first = await raster.start(actualRequest(native, f)); assert.ok(first.status !== 'cancelled'); assert.equal(first.sidecar?.status, 'failed');
		f.clean(); assert.deepEqual(f.document.clicked, ['Photo-1.png']); f.document.visibility(false);
		const retry = raster.retrySidecar(); await waitFor(() => f.frames.size === 1, 'the explicit JSON retry opportunity'); f.frame();
		await waitFor(() => f.document.clicked.length === 2 && f.frames.size === 1, 'the actual JSON retry anchor'); f.frame();
		const result = await retry; assert.ok(result.status !== 'cancelled'); assert.equal(result.sidecar?.status, 'download-started');
		assert.deepEqual(f.document.clicked, ['Photo-1.png', 'Photo-1.png.lightscaper.json']);
		assert.equal(native.events.filter(event => event === 'encode').length, 1); f.clean();
	} finally { f.document.visibility(true); await raster.cancelAndJoin(); await native.close(); }
});

for (const retirement of ['abort', 'hide'] as const) test(`actual Current ${retirement} after JSON click preserves both irreversible receipts and joins presentation`, { timeout: 10_000 }, async () => {
	const native = await repairRasterFixture(), f = fixture(), raster = new PhotoRasterExportCurrentV1('png');
	const before = await native.inspect(), work = raster.start(actualRequest(native, f)), joined = work.then(() => undefined, () => undefined);
	try {
		await waitFor(() => f.frames.size === 1, 'the actual Current pre-JSON opportunity'); f.frame();
		await waitFor(() => f.document.clicked.length === 2 && f.frames.size === 1, 'the actual Current post-JSON opportunity');
		if (retirement === 'hide') f.document.visibility(true); else await raster.cancelAndJoin(Object.freeze({ close: 'after JSON click' }));
		const result = await work; assert.ok(result.status !== 'cancelled'); assert.equal(result.status, 'download-started');
		assert.equal(result.sidecar?.status, 'download-started');
		assert.deepEqual(f.document.clicked, ['Photo-1.png', 'Photo-1.png.lightscaper.json']); f.clean();
		assert.equal(raster.isPending(), false); assert.deepEqual(await native.inspect(), before);
	} finally { f.document.visibility(true); await raster.cancelAndJoin(); await joined; await native.close(); }
});

function actualRequest(native: Awaited<ReturnType<typeof repairRasterFixture>>, f: ReturnType<typeof fixture>): PhotoRasterExportRequestCurrentV1 {
	const render = createPhotoDevelopRenderRuntimeCurrentV1({ source: native.session.cubeLuts.source, maskSource: native.session.maskRasterSource });
	return { ...native.request(), loadRenderer: async () => render,
		encode: (frame, { bitDepth, ...options }) => { native.events.push('encode'); assert.ok(bitDepth === undefined || bitDepth === 8); return encodePixelFramePngV1(frame, options); },
		sidecar: { read: native.readSidecar }, saveFile: f.service.saveFile };
}
