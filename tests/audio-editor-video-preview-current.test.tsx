/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import VideoPreviewPanel from '../src/common/editor/ui/workspace/VideoPreviewPanel.jsx';
import { bindProductVideoVisualPreviewRuntime, createProductVideoVisualPreviewRuntime } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import type { ProductVideoVisualPreviewRuntime } from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import { createVideoPreviewSessionOwner } from '../src/common/editor/controller/clip-video/video-preview-session-owner.ts';
import { invalidateEnginePlayhead } from '../src/common/editor/engine/playhead-discontinuity.ts';
import { framescaperSelectedFreezeCaptureFinishingFor } from '../src/framescaper/editor-selected-finishing-freeze-capture.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { ReactTestElement } from './helpers/react-test-dom.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const frame = { layers: [], adjustments: [], activeFreezeNodeIds: [], availablePresetIds: [],
	ledger: { requestedNodeIds: [], consumedNodeIds: [], omittedNodeIds: [] } };
const project = { id: 'preview', revision: 1, sampleRate: 48_000, tracks: [], clips: [], sources: [] };

async function mountedHeldPanel(create?: ProductVideoVisualPreviewRuntime['create'], options: Readonly<{
	project?: Readonly<Record<string, unknown>>;
	stopped?: boolean;
	pixel?: () => number;
}> = {}) {
	const held = deferred<void>(), cleanup = deferred<void>(); let signal: AbortSignal | undefined, reads = 0, deletes = 0;
	const controller = { actions: {}, engine: { sampleRate: 48_000, getPositionFrames: () => 0 },
		getTelemetrySnapshot: () => ({ positionFrame: 0, transportState: options.stopped ? 'stopped' : 'playing', playbackRate: 1 }), subscribeTelemetry: () => () => undefined };
	let currentController = controller;
	let currentProject: Readonly<Record<string, unknown>> = options.project ?? project;
	bindProductVideoVisualPreviewRuntime(controller, createProductVideoVisualPreviewRuntime(create ?? (async () => ({
		exactPlaying: true, resolve: () => frame, resolveTransitionWeight: () => null, dispose() {}, close: () => cleanup.promise,
		async renderExact(request) { reads++; signal = request.signal; await held.promise; return { frame, layers: [], renderedEffectIds: [] }; },
	}))));
	const prototype = ReactTestElement.prototype;
	const priorContext = Object.getOwnPropertyDescriptor(prototype, 'getContext');
	Object.defineProperty(prototype, 'getContext', { configurable: true, value() { return new Proxy({}, { get(_target, key) {
		if (key === 'FRAMEBUFFER_COMPLETE') return 0x8CD5;
		return (...args: unknown[]) => {
			if (key === 'deleteProgram') deletes++;
			if (key === 'checkFramebufferStatus') return 0x8CD5;
			const target = args.at(-1);
			if (key === 'readPixels' && target instanceof Uint8Array) target.fill(options.pixel?.() ?? 0);
			return key === 'getShaderParameter' || key === 'getProgramParameter' ? true : {};
		};
	} }); } });
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React'); Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const queued = new Map<number, FrameRequestCallback>(); let nextId = 0;
	let installed = false;
	function View() {
		if (!installed) { installed = true; Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true,
			value(callback: FrameRequestCallback) { const id = ++nextId; queued.set(id, callback); return id; } });
			Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value(id: number) { queued.delete(id); } }); }
		return <VideoPreviewPanel controller={currentController} snapshot={{ project: currentProject, missingSourceIds: [] }} copy={ENGLISH_COPY} run={() => undefined} />;
	}
	const mounted = await mountPhotoImportUi(() => <View />);
	const flush = async () => { await act(async () => {
		const entry = queued.entries().next().value; assert.ok(entry); queued.delete(entry[0]); entry[1](0); await settle();
	}); };
	await flush();
	return { held, cleanup, mounted, controller, flush, queued: () => queued.size, signal: () => signal, reads: () => reads, deletes: () => deletes,
		async replaceController(next: typeof controller) { currentController = next; await mounted.render(); await act(async () => { await settle(); }); },
		async replaceProject(next: Readonly<Record<string, unknown>>) { currentProject = next; await mounted.render(); await act(async () => { await settle(); }); },
		async restore() {
			held.resolve(); cleanup.resolve(); await mounted.dispose(); await settle();
			if (priorContext) Object.defineProperty(prototype, 'getContext', priorContext); else Reflect.deleteProperty(prototype, 'getContext');
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
		} };
}

test('the actual playing Panel passes its native coordinator signal to the resource-capable Session', async () => {
	const fixture = await mountedHeldPanel();
	try { assert.equal(fixture.reads(), 1); assert.ok(fixture.signal() instanceof AbortSignal); }
	finally { await fixture.restore(); }
});

function freezeProject(id: string, revision: number) {
	return { ...project, id, revision, schemaFamily: 'framescaper', schemaVersion: 1,
		primarySequenceId: 'cut', clips: [{ id: 'camera', sourceId: 'source', sequenceId: 'cut' }],
		selection: { clipIds: [] } };
}

function installPngCapture(context: import('node:test').TestContext) {
	const priorImageData = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
	const prototype = ReactTestElement.prototype;
	const priorToBlob = Object.getOwnPropertyDescriptor(prototype, 'toBlob');
	let pixels: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray();
	Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class {
		constructor(data: Uint8ClampedArray<ArrayBuffer>) { pixels = data; }
	} });
	Object.defineProperty(prototype, 'toBlob', { configurable: true,
		value(callback: (blob: Blob) => void) { callback(new Blob([pixels], { type: 'image/png' })); } });
	context.after(() => {
		if (priorImageData) Object.defineProperty(globalThis, 'ImageData', priorImageData); else Reflect.deleteProperty(globalThis, 'ImageData');
		if (priorToBlob) Object.defineProperty(prototype, 'toBlob', priorToBlob); else Reflect.deleteProperty(prototype, 'toBlob');
	});
}

for (const stopped of [true, false]) test(`a queued ${stopped ? 'stopped' : 'playing'} Panel frame evaluates the replacement project rather than its captured predecessor`, async context => {
	installPngCapture(context);
	const drawn: string[] = [];
	let pixel = 0;
	const fixture = await mountedHeldPanel(async ({ project: owner }) => {
		const value = owner as Readonly<{ id: string; revision: number }>;
		return { exactPlaying: true, resolve: () => frame, resolveTransitionWeight: () => null, dispose() {},
			async renderExact() {
				drawn.push(`${value.id}:${String(value.revision)}`); pixel = value.revision;
				return { frame, layers: [], renderedEffectIds: [] };
			} };
	}, { project: freezeProject('old-project', 1), stopped, pixel: () => pixel });
	try {
		assert.deepEqual(drawn, ['old-project:1']);
		if (stopped) await act(async () => { invalidateEnginePlayhead(fixture.controller.engine); await settle(); });
		assert.equal(fixture.queued(), 1);
		await fixture.replaceProject(freezeProject('new-project', 2));
		assert.equal(fixture.queued(), 1, 'replacement demand must coalesce without keeping the old callback');
		await fixture.flush();
		assert.deepEqual(drawn, ['old-project:1', 'new-project:2']);
		const capture = framescaperSelectedFreezeCaptureFinishingFor(fixture.controller); assert.ok(capture);
		const result = await capture.capture({ projectId: 'new-project', projectRevision: 2, timelineSample: 0,
			clipId: 'camera', sourceId: 'source', sourceOrdinal: 0 });
		const encoded = new Uint8Array(await result.blob.arrayBuffer());
		assert.equal(encoded.byteLength, result.width * result.height * 4);
		assert.deepEqual([...encoded.slice(0, 4)], [2, 2, 2, 255]);
		assert.equal(fixture.queued(), stopped ? 0 : 1, 'a stopped preview must not create a continuous RAF loop');
	} finally { await fixture.restore(); }
});

test('the latest Panel requester remains blocked while the replacement Session joins', async () => {
	const replacement = deferred<void>();
	let factories = 0, draws = 0;
	const fixture = await mountedHeldPanel(async () => {
		if (++factories > 1) await replacement.promise;
		return { exactPlaying: true, resolve: () => frame, resolveTransitionWeight: () => null, dispose() {},
			async renderExact() { draws++; return { frame, layers: [], renderedEffectIds: [] }; } };
	});
	try {
		assert.equal(draws, 1); assert.equal(fixture.queued(), 1);
		await fixture.replaceProject({ ...project, revision: 2 });
		await fixture.flush();
		assert.equal(draws, 1, 'a queued request must not draw with the predecessor while replacement is pending');
		assert.equal(fixture.queued(), 0);
		replacement.resolve(); await act(async () => { await settle(); });
		assert.equal(fixture.queued(), 1); await fixture.flush(); assert.equal(draws, 2);
	} finally { replacement.resolve(); await fixture.restore(); }
});

test('the actual Panel unmount revokes its held request and waits both frame and Session before disposing its compositor', async () => {
	const fixture = await mountedHeldPanel();
	try {
		await fixture.mounted.dispose(); assert.equal(fixture.deletes(), 0);
		assert.equal(fixture.signal()?.aborted, true);
		fixture.held.resolve(); await settle(); assert.equal(fixture.deletes(), 0);
		fixture.cleanup.resolve(); await settle(); assert.ok(fixture.deletes() > 0);
	} finally { await fixture.restore(); }
});

test('actual controller replacement closes only its captured old Session and leaves the new Session alive after the held frame and cleanup join', async () => {
	const fixture = await mountedHeldPanel(); let factories = 0, closes = 0, reads = 0;
	const next = { ...fixture.controller, engine: { ...fixture.controller.engine } };
	bindProductVideoVisualPreviewRuntime(next, createProductVideoVisualPreviewRuntime(async () => {
		factories++; return { exactPlaying: true, resolve: () => frame, resolveTransitionWeight: () => null, dispose() {},
			async close() { closes++; }, async renderExact() { reads++; return { frame, layers: [], renderedEffectIds: [] }; } };
	}));
	try {
		await fixture.replaceController(next); assert.equal(fixture.signal()?.aborted, true); assert.equal(factories, 0);
		fixture.held.resolve(); await act(async () => { await settle(); }); assert.equal(factories, 0);
		fixture.cleanup.resolve(); await act(async () => { await settle(); }); assert.equal(factories, 1); assert.equal(closes, 0);
		await fixture.flush(); assert.equal(reads, 1);
	} finally { await fixture.restore(); }
	assert.equal(closes, 1);
});

async function mountedHeldCancellationPanel(cleanupFailure?: Readonly<{ value: unknown }>) {
	const held = deferred<void>(), cleanup = deferred<void>(), frameJoined = deferred<void>();
	const events: string[] = [];
	let factories = 0, completedFrames = 0, coordinatorSignal!: AbortSignal, combinedSignal!: AbortSignal, sessionStop!: AbortSignal, retirementStop!: AbortSignal;
	let closing: Promise<void> | undefined;
	const fixture = await mountedHeldPanel(async ({ signal: sessionSignal }) => {
		assert.ok(sessionSignal instanceof AbortSignal);
		const generation = ++factories, retirement = new AbortController();
		if (generation === 1) {
			sessionStop = sessionSignal; retirementStop = retirement.signal;
			sessionSignal.addEventListener('abort', () => { events.push('session-abort'); }, { once: true });
		}
		return { exactPlaying: true, resolve: () => frame, resolveTransitionWeight: () => null, dispose() {},
			close() {
				if (generation !== 1) return Promise.resolve();
				if (closing) return closing;
				closing = (async () => {
					retirement.abort(new DOMException('The test resource session was retired.', 'AbortError'));
					await frameJoined.promise;
					await cleanup.promise;
					events.push('session-cleanup');
					if (cleanupFailure) throw cleanupFailure.value;
				})();
				void closing.catch(() => undefined);
				return closing;
			},
			async renderExact(request) {
				if (generation === 1) {
					assert.ok(request.signal instanceof AbortSignal);
					coordinatorSignal = request.signal;
					coordinatorSignal.addEventListener('abort', () => { events.push('coordinator-abort'); }, { once: true });
					combinedSignal = AbortSignal.any([sessionSignal, coordinatorSignal, retirement.signal]);
					combinedSignal.addEventListener('abort', () => { events.push('combined-abort'); }, { once: true });
					try { await held.promise; combinedSignal.throwIfAborted(); }
					finally { events.push('frame-joined'); frameJoined.resolve(); }
				}
				completedFrames++;
				return { frame, layers: [], renderedEffectIds: [] };
			},
		};
	});
	return { ...fixture, frameHeld: held, sessionCleanup: cleanup, events, factories: () => factories,
		completedFrames: () => completedFrames, coordinatorSignal: () => coordinatorSignal, combinedSignal: () => combinedSignal,
		sessionSignal: () => sessionStop, retirementSignal: () => retirementStop,
		closing: () => closing,
		async restore() { held.resolve(); cleanup.resolve(); await fixture.restore(); await settle(); } };
}

test('mounted project replacement cancels the coordinator before its resource Session and admits an error-free replacement only after both actual joins', async () => {
	const fixture = await mountedHeldCancellationPanel();
	try {
		assert.equal(fixture.factories(), 1);
		for (const signal of [fixture.sessionSignal(), fixture.coordinatorSignal(), fixture.retirementSignal(), fixture.combinedSignal()]) assert.equal(signal.aborted, false);
		await fixture.replaceProject({ ...project, revision: 2 });
		assert.equal(fixture.coordinatorSignal().aborted, true);
		assert.equal(fixture.combinedSignal().reason, fixture.coordinatorSignal().reason, `Cancellation order: ${fixture.events.join(', ')}`);
		assert.ok(fixture.events.indexOf('coordinator-abort') < fixture.events.indexOf('session-abort'));
		assert.ok(fixture.events.indexOf('combined-abort') < fixture.events.indexOf('session-abort'));
		assert.equal(fixture.factories(), 1); assert.equal(fixture.completedFrames(), 0);
		fixture.frameHeld.resolve(); await act(async () => { await settle(); });
		assert.ok(fixture.events.includes('frame-joined')); assert.equal(fixture.factories(), 1);
		assert.equal(fixture.completedFrames(), 0);
		fixture.sessionCleanup.resolve(); await act(async () => { await settle(); });
		assert.equal(fixture.factories(), 2);
		await fixture.flush();
		assert.equal(fixture.completedFrames(), 1);
		assert.equal(fixture.mounted.dom.one('[data-video-preview-renderer]').getAttribute('data-video-preview-visual-error'), '');
	} finally { await fixture.restore(); }
});

test('mounted project replacement preserves an opaque Session cleanup failure and never opens its replacement', async () => {
	let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const fixture = await mountedHeldCancellationPanel({ value: reason });
	try {
		await fixture.replaceProject({ ...project, revision: 2 });
		fixture.frameHeld.resolve(); await act(async () => { await settle(); });
		assert.equal(fixture.factories(), 1);
		fixture.sessionCleanup.resolve(); await act(async () => { await settle(); });
		const observed = await fixture.closing()!.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
		assert.equal(observed.error, reason); assert.equal(fixture.factories(), 1); assert.equal(fixture.completedFrames(), 0);
		assert.equal(fixture.mounted.dom.one('[data-video-preview-renderer]').getAttribute('data-video-preview-visual-error'), ENGLISH_COPY.videoPreviewUnavailable);
		assert.equal(traps, 0);
	} finally { await fixture.restore(); }
});

test('a synchronous hard barrier can reenter cached retirement and throw opaque failure while actual Session cleanup still joins', async () => {
	const cleanup = deferred<void>(); let retiring = false, signal!: AbortSignal, nested: Promise<void> | undefined, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const events: string[] = [];
	const owner = createVideoPreviewSessionOwner(() => undefined, () => {
		if (!retiring) return;
		events.push('hard-barrier');
		assert.equal(signal.aborted, false);
		nested = owner.close();
		throw reason;
	});
	await owner.replace(stop => {
		signal = stop;
		return { dispose() {}, close() { events.push('session-close'); return cleanup.promise; } };
	});
	retiring = true;
	const closing = owner.close(), observed = closing.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	try {
		assert.equal(nested, closing); assert.equal(signal.aborted, true);
		assert.deepEqual(events, ['hard-barrier', 'session-close']);
		assert.equal(await remainsPending(closing), true);
		cleanup.resolve(); assert.equal((await observed).error, reason);
		assert.equal(owner.close(), closing); assert.equal(traps, 0);
	} finally { cleanup.resolve(); await observed; }
});
