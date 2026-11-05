/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import React, { act } from 'react';
import MotionPreviewDialog from '../src/common/editor/ui/motionscaper/MotionPreviewDialog.tsx';
import type { MotionPreviewWorkerRequest, MotionPreviewWorkerResponse } from '../src/common/editor/motion-preview-worker-protocol.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';
import { motionscaperCopy } from '../src/common/editor/ui/motionscaper/motionscaper-copy.ts';
import { floatWave } from './helpers/float32-wave-fixture.ts';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test('Motion preview keeps video on the primed audio clock and ends the whole range after delayed scheduling', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom(); const prior = new Map<PropertyKey, PropertyDescriptor | undefined>();
	const bytes = floatWave(8000, 1, new Uint8Array(new Float32Array(8000).fill(0.25).buffer));
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const base = createMotionscaperProject({ id: 'sync', title: 'Sync', compositionId: 'main', width: 2, height: 2, durationFrames: 30, sampleRate: 8000 });
	const project = { ...base, assets: [{ id: 'sound', kind: 'audio' as const, name: 'Sound', sha256, storageKey: `motion-sha256:${sha256}`, byteLength: bytes.length, mimeType: 'audio/wav', sampleRate: 8000, channels: 1, duration: { num: 1, den: 1 } }],
		compositions: [{ ...base.compositions[0]!, audio: [{ id: 'placed', assetId: 'sound', startFrame: { num: 0, den: 1 }, inFrame: { num: 0, den: 1 }, outFrame: { num: 30, den: 1 }, sourceStart: { num: 0, den: 1 }, timeScale: { num: 1, den: 1 }, enabled: true, gain: motionScalar(1) }] }] };
	let time = 10; let closed = false;
	const scheduled: { when: number; count: number; ended: (() => void) | null; stopped: boolean }[] = [];
	const output = { sampleRate: 8000, get currentTime() { return time; }, destination: {}, resume: () => Promise.resolve(), close: () => { closed = true; return Promise.resolve(); },
		createBuffer(_channels: number, count: number) { return { length: count, getChannelData: () => new Float32Array(count) }; },
		createBufferSource() {
			const source = { buffer: null as { length: number } | null, onended: null as (() => void) | null, connect() {}, disconnect() {},
				start(when: number) { scheduled.push({ when, count: source.buffer!.length, ended: () => source.onended?.(), stopped: false }); time += 0.2; },
				stop() { const item = scheduled.find(item => item.ended === source.onended); if (item) item.stopped = true; } };
			return source;
		},
	};
	class Worker extends EventTarget {
		postMessage(request: MotionPreviewWorkerRequest) {
			if (request.type === 'project') this.emit({ type: 'ready', requestId: request.requestId, backend: 'worker-cpu' });
			else if (request.type === 'render') this.emit({ type: 'frame', requestId: request.requestId, frame: { ...request, revision: 0, width: 2, height: 2, rgba: new Uint8ClampedArray(16), backend: 'worker-cpu' } });
		}
		emit(data: MotionPreviewWorkerResponse) { this.dispatchEvent(new MessageEvent('message', { data })); }
		terminate() {}
	}
	for (const [key, value] of Object.entries({ Worker, React, IS_REACT_ACT_ENVIRONMENT: true,
		AudioContext: function () { return output; },
		ImageData: class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} },
	})) { prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
	const priorContext = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => ({ putImageData() {} }) });
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	const button = () => dom.one('.motionscaper-preview-controls').querySelectorAll('button')[0]!;
	const wait = async (condition: () => boolean) => { for (let i = 0; i < 100 && !condition(); i++) await act(turn); assert.equal(condition(), true, dom.container.textContent); };
	try {
		await act(async () => root.render(React.createElement(MotionPreviewDialog, { copy: motionscaperCopy('en'), project, store: { readAsset: () => Promise.resolve(new Blob([new Uint8Array(bytes)])) }, onClose() {} })));
		await wait(() => !button().hasAttribute('disabled'));
		await act(async () => { reactProps(button()).onClick!(); }); await wait(() => scheduled.length === 2);
		await act(turn);
		const frameAfterPriming = dom.one('canvas').dataset.motionFrame;
		time = scheduled[0]!.when + 1;
		await act(async () => { for (const item of scheduled) item.ended?.(); t.mock.timers.tick(40); await turn(); });
		assert.deepEqual({ frameAfterPriming, buttonAfterEnd: button().textContent }, { frameAfterPriming: '10', buttonAfterEnd: motionscaperCopy('en').motionscaperPlay },
			'Video must catch up to350ms of elapsed audio and complete its full range when the final PCM sample ends.');
		assert.equal(dom.container.querySelectorAll('[role="alert"]').length, 0);
	} finally {
		await act(async () => root.unmount()); assert.equal(closed, true);
		if (priorContext) Object.defineProperty(ReactTestElement.prototype, 'getContext', priorContext); else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
		dom.restore();
	}
});
