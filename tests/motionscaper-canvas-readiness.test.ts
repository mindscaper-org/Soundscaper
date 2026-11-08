/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import MotionCanvasDialog from '../src/common/editor/ui/motionscaper/MotionCanvasDialog.tsx';
import type { MotionPreviewWorkerRequest, MotionPreviewWorkerResponse } from '../src/common/editor/motion-preview-worker-protocol.ts';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import type { MotionscaperProject } from '../src/motionscaper/editor-project-types.ts';
import type { MotionscaperProjectCommand } from '../src/motionscaper/editor-project-commands.ts';
import { motionColor, motionVector } from '../src/common/editor/motion-property.ts';
import { motionscaperCopy } from '../src/common/editor/ui/motionscaper/motionscaper-copy.ts';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

function project(title = 'Canvas') {
	const value = createMotionscaperProject({ id: 'canvas', title, compositionId: 'main', width: 100, height: 100 });
	const layer = createMotionLayer({ id: 'solid', name: 'Solid', durationFrames: 300, content: { kind: 'solid', size: motionVector([20, 20]), color: motionColor([1, 0, 0, 1]) } });
	const composition = { ...value.compositions[0]!, layers: [{ ...layer, transform: { ...layer.transform, position: motionVector([30, 30, 0]) } }] };
	return { ...value, compositions: [composition, { ...composition, id: 'second', name: 'Second' }] };
}
const copy = motionscaperCopy('en');
const store = () => ({ readAsset: () => Promise.reject(new Error('No asset expected.')) });

async function mountedCanvas(immediate = false) {
	const dom = installReactTestDom();
	const globals = new Map<PropertyKey, PropertyDescriptor | undefined>();
	const prototypes = new Map<string, PropertyDescriptor | undefined>();
	const workers: ControlledWorker[] = [];
	const edits: (readonly MotionscaperProjectCommand[])[] = [];
	let value = project(); let assets = store(); let paints = 0; let failPaint = false;
	let firstRender!: () => void;
	const started = new Promise<void>(resolve => { firstRender = resolve; });
	type Render = Extract<MotionPreviewWorkerRequest, { type: 'render' }>;
	class ControlledWorker extends EventTarget {
		retained: MotionscaperProject = value;
		pending: Render | null = null;
		terminated = false;
		constructor() { super(); workers.push(this); }
		postMessage(message: MotionPreviewWorkerRequest) {
			if (message.type === 'project') { this.retained = message.project; this.emit({ type: 'ready', requestId: message.requestId, backend: 'worker-cpu' }); }
			else if (message.type === 'render') { this.pending = message; firstRender(); if (immediate) this.paint(); }
			else if (message.type === 'cancel') { this.pending = null; this.emit({ type: 'error', requestId: message.requestId, name: 'AbortError', message: 'Cancelled.' }); }
		}
		emit(data: MotionPreviewWorkerResponse) { this.dispatchEvent(new MessageEvent('message', { data })); }
		fail() { const request = this.pending; assert.ok(request); this.pending = null; this.emit({ type: 'error', requestId: request.requestId, name: 'Error', message: 'Worker render failed.' }); }
		paint(request = this.pending) {
			assert.ok(request, 'The preview must have an outstanding render.');
			if (request === this.pending) this.pending = null;
			this.emit({ type: 'frame', requestId: request.requestId, frame: { ...request, revision: this.retained.revision,
				width: 100, height: 100, rgba: new Uint8ClampedArray(40_000).fill(42), backend: 'worker-cpu' } });
		}
		terminate() { this.terminated = true; }
	}
	for (const [key, item] of Object.entries({
		Worker: ControlledWorker, React, IS_REACT_ACT_ENVIRONMENT: true,
		ImageData: class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} },
		ResizeObserver: class { observe() {} disconnect() {} },
		DOMPoint: class { constructor(readonly x: number, readonly y: number) {} matrixTransform() { return this; } },
	})) {
		globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: item });
	}
	const captured = new Set<number>();
	for (const [key, item] of Object.entries({
		getContext: () => ({ putImageData() { if (failPaint) throw new Error('Canvas paint failed.'); paints++; } }),
		getScreenCTM: () => ({ a: 1, b: 0, inverse() { return this; } }),
		setPointerCapture: (pointer: number) => { captured.add(pointer); },
		hasPointerCapture: (pointer: number) => captured.has(pointer),
		releasePointerCapture: (pointer: number) => { captured.delete(pointer); },
	})) {
		prototypes.set(key, Object.getOwnPropertyDescriptor(ReactTestElement.prototype, key));
		Object.defineProperty(ReactTestElement.prototype, key, { configurable: true, value: item });
	}
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	const render = async (next = value, nextStore = assets) => {
		value = next; assets = nextStore;
		await act(async () => root.render(React.createElement(MotionCanvasDialog, { copy, project: value, store: assets, busy: false, canUndo: false, canRedo: false,
			onEdit: commands => { edits.push(commands); return Promise.resolve(); }, onUndo: () => Promise.resolve(), onRedo: () => Promise.resolve(), onClose() {} })));
	};
	await render(); await act(async () => { await started; });
	const controls = () => dom.one('.motionscaper-preview-controls');
	const change = async (element: ReactTestElement, next: string) => { await act(async () => { reactProps(element).onChange!({ currentTarget: { value: next } }); }); };
	const overlay = () => dom.one('[data-motion-canvas-overlay]');
	const pointer = async (handler: string, x: number, y: number) => {
		await act(async () => { reactProps(overlay())[handler]!({ target: dom.one('[data-motion-canvas-handle="move"]'), pointerId: 1, button: 0, clientX: x, clientY: y, preventDefault() {} }); });
	};
	return {
		dom, workers, edits, render, captured, paints: () => paints, failPaint: () => { failPaint = true; },
		status: () => dom.one('[role="status"]').textContent,
		select: () => change(controls().querySelectorAll('select')[1]!, 'solid'),
		composition: () => change(controls().querySelectorAll('select')[0]!, 'second'),
		seek: (frame: string) => change(controls().querySelector('input')!, frame),
		async paint() { await act(async () => workers.at(-1)!.paint()); },
		async key(key = 'ArrowRight') { await act(async () => { reactProps(overlay()).onKeyDown!({ key, target: overlay(), shiftKey: false, preventDefault() {}, stopPropagation() {} }); }); },
		start: () => pointer('onPointerDown', 30, 30), move: (x: number) => pointer('onPointerMove', x, 30), finish: (x: number) => pointer('onPointerUp', x, 30),
		async close() {
			await act(async () => root.unmount());
			for (const [key, descriptor] of prototypes) { if (descriptor) Object.defineProperty(ReactTestElement.prototype, key, descriptor); else Reflect.deleteProperty(ReactTestElement.prototype, key); }
			for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
			dom.restore();
		},
	};
}

for (const replacement of ['project', 'composition', 'frame', 'store'] as const) {
	test(`Canvas editing waits for the current ${replacement} pixels after a painted frame`, async () => {
		const canvas = await mountedCanvas();
		try {
			await canvas.select(); await canvas.key(); assert.equal(canvas.edits.length, 0);
			await canvas.paint(); assert.match(canvas.status(), /Preview ready/);
			if (replacement === 'project') await canvas.render(project('Replacement with the same revision'));
			else if (replacement === 'composition') { await canvas.composition(); await canvas.select(); }
			else if (replacement === 'frame') await canvas.seek('1');
			else await canvas.render(undefined, store());
			await canvas.key(); await canvas.start(); await canvas.move(40); await canvas.finish(40);
			assert.equal(canvas.edits.length, 0, 'Neither keyboard nor pointer edits may use stale painted pixels.');
			assert.equal(canvas.status(), copy.motionscaperWorking);
			await canvas.paint(); await canvas.key(); assert.equal(canvas.edits.length, 1, 'The matching paint enables editing.');
		} finally { await canvas.close(); }
	});
}

test('Canvas paint failure revokes editing authority from the previously painted frame', async () => {
	const canvas = await mountedCanvas();
	try {
		await canvas.select(); await canvas.paint(); await canvas.seek('1'); canvas.failPaint(); await canvas.paint();
		assert.match(canvas.dom.one('[role="alert"]').textContent, /Canvas paint failed/);
		await canvas.key(); assert.equal(canvas.edits.length, 0);
		assert.equal(canvas.status(), copy.motionscaperWorking);
	} finally { await canvas.close(); }
});

test('Canvas ignores a cancelled frame and waits for the latest coalesced seek to paint', async () => {
	const canvas = await mountedCanvas();
	try {
		await canvas.select(); await canvas.paint(); await canvas.seek('1');
		const worker = canvas.workers.at(-1)!; const stale = worker.pending; assert.ok(stale);
		await canvas.seek('2'); await act(async () => worker.paint(stale));
		assert.equal(canvas.paints(), 1); await canvas.key(); assert.equal(canvas.edits.length, 0);
		await canvas.paint(); await canvas.key(); assert.equal(canvas.edits.length, 1);
	} finally { await canvas.close(); }
});

test('Canvas keeps one pointer gesture alive while coalescing unpainted draft transforms', async () => {
	const canvas = await mountedCanvas();
	try {
		await canvas.select(); await canvas.paint(); await canvas.start(); assert.equal(canvas.captured.has(1), true);
		await canvas.move(40); await canvas.paint(); await canvas.move(50); assert.equal(canvas.edits.length, 0);
		assert.equal(canvas.status(), copy.motionscaperCanvasDraft); assert.equal(canvas.paints(), 2);
		await canvas.finish(50); assert.equal(canvas.captured.size, 0); assert.equal(canvas.edits.length, 1);
		const command = canvas.edits[0]!.find(item => item.type === 'layer/replace'); assert.ok(command);
		assert.deepEqual(command.layer.transform.position.value, [50, 30, 0], 'The final pointer position, rather than the last rendered draft, is committed.');
	} finally { await canvas.close(); }
});


test('Canvas accepts a matching first frame delivered immediately by its worker', async () => {
	const canvas = await mountedCanvas(true);
	try { assert.equal(canvas.paints(), 1); await canvas.select(); await canvas.key(); assert.equal(canvas.edits.length, 1); }
	finally { await canvas.close(); }
});

test('Canvas render errors revoke readiness and a later successful base paint restores it', async () => {
	const canvas = await mountedCanvas();
	try {
		await canvas.select(); await canvas.paint(); await canvas.seek('1');
		await act(async () => canvas.workers.at(-1)!.fail());
		assert.match(canvas.dom.one('[role="alert"]').textContent, /Worker render failed/);
		await canvas.key(); assert.equal(canvas.edits.length, 0);
		await canvas.seek('2'); await canvas.paint(); await canvas.key(); assert.equal(canvas.edits.length, 1);
	} finally { await canvas.close(); }
});

for (const replacement of ['project', 'store'] as const) {
	test(`Canvas cancels a draft gesture when its ${replacement} session changes`, async () => {
		const canvas = await mountedCanvas();
		try {
			await canvas.select(); await canvas.paint(); await canvas.start(); await canvas.move(40);
			const old = canvas.workers.at(-1)!; const stale = old.pending; assert.ok(stale);
			if (replacement === 'project') await canvas.render(project('Replaced during a gesture'));
			else await canvas.render(undefined, store());
			await act(async () => old.paint(stale));
			assert.equal(canvas.paints(), 1, 'A superseded session cannot paint late pixels.');
			assert.equal(canvas.captured.size, 0, 'Replacing the gesture owner releases capture.');
			await canvas.finish(50); assert.equal(canvas.edits.length, 0);
			assert.equal(canvas.status(), copy.motionscaperWorking);
			await canvas.paint(); await canvas.key(); assert.equal(canvas.edits.length, 1);
		} finally { await canvas.close(); }
	});
}


test('Canvas waits for base pixels after cancelling a painted draft', async () => {
	const canvas = await mountedCanvas();
	try {
		await canvas.select(); await canvas.paint(); await canvas.start(); await canvas.move(40); await canvas.paint();
		await canvas.key('Escape'); assert.equal(canvas.captured.size, 0);
		await canvas.key(); assert.equal(canvas.edits.length, 0, 'Painted draft pixels cannot authorize a new base edit.');
		assert.equal(canvas.status(), copy.motionscaperWorking);
		await canvas.paint(); await canvas.key(); assert.equal(canvas.edits.length, 1);
	} finally { await canvas.close(); }
});
