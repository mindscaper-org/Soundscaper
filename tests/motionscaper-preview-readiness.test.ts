/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import MotionPreviewDialog from '../src/common/editor/ui/motionscaper/MotionPreviewDialog.tsx';
import type { MotionPreviewWorkerRequest, MotionPreviewWorkerResponse } from '../src/common/editor/motion-preview-worker-protocol.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { motionscaperCopy } from '../src/common/editor/ui/motionscaper/motionscaper-copy.ts';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

const project = (revision = 0) => ({ ...createMotionscaperProject({ id: 'preview', title: 'Preview', compositionId: 'main', width: 2, height: 2 }), revision });
const copy = motionscaperCopy('en');
const store = { readAsset: () => Promise.reject(new Error('No asset expected.')) };

function deferred() {
	let resolve!: () => void;
	return { promise: new Promise<void>((complete) => { resolve = complete; }), resolve: () => resolve() };
}

async function mountedPreview(immediate = false) {
	const dom = installReactTestDom();
	const prior = new Map<PropertyKey, PropertyDescriptor | undefined>();
	const started = deferred();
	const workers: ControlledWorker[] = [];
	let paints = 0;
	class ControlledWorker extends EventTarget {
		retained = project();
		pending: Extract<MotionPreviewWorkerRequest, { type: 'render' }> | null = null;
		terminated = false;
		constructor() { super(); workers.push(this); }
		postMessage(message: MotionPreviewWorkerRequest) {
			if (message.type === 'project') {
				this.retained = message.project;
				this.emit({ type: 'ready', requestId: message.requestId, backend: 'worker-cpu' });
			} else if (message.type === 'render') {
				this.pending = message; started.resolve();
				if (immediate) this.paint();
			} else if (message.type === 'cancel') {
				this.pending = null;
				this.emit({ type: 'error', requestId: message.requestId, name: 'AbortError', message: 'Cancelled.' });
			}
		}
		emit(data: MotionPreviewWorkerResponse) { this.dispatchEvent(new MessageEvent('message', { data })); }
		paint() {
			const request = this.pending; assert.ok(request, 'A frame must be requested before it can paint.');
			this.pending = null;
			this.emit({ type: 'frame', requestId: request.requestId, frame: { ...request, revision: this.retained.revision,
				width: 2, height: 2, rgba: new Uint8ClampedArray(16).fill(42), backend: 'worker-cpu' } });
		}
		terminate() { this.terminated = true; }
	}
	for (const [key, value] of Object.entries({
		Worker: ControlledWorker, React, IS_REACT_ACT_ENVIRONMENT: true,
		ImageData: class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} },
	})) {
		prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const priorContext = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => ({ putImageData() { paints++; } }) });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (value = project()) => {
		await act(async () => root.render(React.createElement(MotionPreviewDialog, { copy, project: value, store, onClose() {} })));
	};
	await render();
	await act(async () => { await started.promise; });
	return {
		dom, workers, render, paints: () => paints,
		frame: () => dom.one('[data-motion-preview-frame]'),
		play: () => dom.one('.motionscaper-preview-controls').querySelectorAll('button')[0]!,
		status: () => dom.one('[role="status"]').textContent,
		async paint() { await act(async () => workers.at(-1)!.paint()); },
		async seek(value: string) { await act(async () => { reactProps(dom.one('[data-motion-preview-frame]')).onChange!({ currentTarget: { value } }); }); },
		async close() {
			await act(async () => root.unmount());
			if (priorContext) Object.defineProperty(ReactTestElement.prototype, 'getContext', priorContext);
			else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
			for (const [key, descriptor] of prior) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
			dom.restore();
		},
	};
}

test('Motion preview waits for painted pixels before enabling playback or frame seeking', async () => {
	const preview = await mountedPreview();
	try {
		assert.equal(preview.paints(), 0);
		assert.equal(preview.frame().hasAttribute('disabled'), true, 'Seeking must wait for the first painted frame.');
		assert.equal(preview.play().hasAttribute('disabled'), true, 'Playback must wait for the first painted frame.');
		assert.equal(preview.status(), copy.motionscaperWorking);
		await preview.paint();
		assert.equal(preview.paints(), 1);
		assert.equal(preview.dom.one('canvas').dataset.motionFrame, '0');
		assert.equal(preview.frame().hasAttribute('disabled'), false);
		assert.equal(preview.play().hasAttribute('disabled'), false);
		assert.equal(preview.status(), copy.motionscaperPreviewReady);
		await preview.seek('10');
		assert.equal(preview.frame().hasAttribute('disabled'), false, 'Later seeking keeps the previously painted preview usable.');
		assert.equal(preview.play().hasAttribute('disabled'), false);
		assert.equal(preview.status(), copy.motionscaperWorking);
		await preview.paint();
		assert.equal(preview.dom.one('canvas').dataset.motionFrame, '10');
	} finally { await preview.close(); }
});

test('Motion preview clears first-frame readiness when replacing an already painted project', async () => {
	const preview = await mountedPreview();
	try {
		await preview.paint();
		await preview.render(project(1));
		assert.equal(preview.workers[0]!.terminated, true);
		assert.equal(preview.frame().hasAttribute('disabled'), true);
		assert.equal(preview.play().hasAttribute('disabled'), true);
		assert.equal(preview.status(), copy.motionscaperWorking);
		await preview.paint();
		assert.equal(preview.dom.one('canvas').dataset.motionRendered, '1');
		assert.equal(preview.play().hasAttribute('disabled'), false);
	} finally { await preview.close(); }
});

test('Motion preview retains readiness when the worker returns its first frame immediately', async () => {
	const preview = await mountedPreview(true);
	try {
		assert.equal(preview.paints(), 1);
		assert.equal(preview.dom.one('canvas').dataset.motionFrame, '0');
		assert.equal(preview.frame().hasAttribute('disabled'), false);
		assert.equal(preview.play().hasAttribute('disabled'), false);
		assert.equal(preview.status(), copy.motionscaperPreviewReady);
	} finally { await preview.close(); }
});
