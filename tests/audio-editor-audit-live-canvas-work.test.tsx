/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import DynamicsActivityPanel from '../src/common/editor/ui/DynamicsActivityPanel.jsx';
import { useParametricEqSpectrum } from '../src/common/editor/ui/useParametricEqSpectrum.ts';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

async function canvasFixture() {
	const dom = installReactTestDom();
	const prior = new Map<string, PropertyDescriptor | undefined>();
	const patch = (key: string, value: unknown) => {
		prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	};
	patch('IS_REACT_ACT_ENVIRONMENT', true);
	patch('React', React);
	patch('devicePixelRatio', 1);
	let invalidator: (() => void) | undefined;
	let disconnected = false;
	patch('ResizeObserver', class {
		constructor(callback: () => void) { invalidator = callback; }
		observe() {}
		disconnect() { disconnected = true; }
	});
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	patch('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
	patch('cancelAnimationFrame', (handle: number) => { frames.delete(handle); });
	let paints = 0;
	let width = 800;
	const context = { clearRect() { paints++; }, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
		fill() {}, stroke() {}, fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: 'round' };
	const priorContext = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	const priorRect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getBoundingClientRect');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => context });
	Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', { configurable: true,
		value: () => ({ width, height: 100, top: 0, left: 0 }) });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		root, get paints() { return paints; },
		async frame(time: number) {
			const entry = frames.entries().next().value;
			assert.ok(entry);
			frames.delete(entry[0]);
			await act(async () => entry[1](time));
		},
		resize() { width = 1000; invalidator?.(); },
		async close() {
			await act(async () => root.unmount());
			assert.equal(frames.size, 0);
			for (const [key, descriptor] of prior) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
			}
			for (const [key, descriptor] of [['getContext', priorContext], ['getBoundingClientRect', priorRect]] as const) {
				if (descriptor) Object.defineProperty(ReactTestElement.prototype, key, descriptor); else Reflect.deleteProperty(ReactTestElement.prototype, key);
			}
			dom.restore();
		},
		get disconnected() { return disconnected; },
	};
}

test('dynamics telemetry keeps polling but repaints only changed readings, options, size, or display density', async () => {
	const fixture = await canvasFixture();
	let polls = 0;
	let sequence = 1;
	let idle = false;
	const readAnalysis = () => { polls++; return idle ? null : { sequence, inputPeak: 1, outputPeak: 0.5, reductionDb: -6 }; };
	try {
		await act(async () => fixture.root.render(<DynamicsActivityPanel readAnalysis={readAnalysis} copy={{}} />));
		await fixture.frame(40);
		const first = fixture.paints;
		await fixture.frame(80);
		idle = true;
		await fixture.frame(120);
		assert.equal(polls, 3);
		assert.equal(fixture.paints, first, 'idle or repeated telemetry must leave the retained canvas intact');
		fixture.resize();
		await fixture.frame(160);
		assert.equal(fixture.paints, first + 1);
		globalThis.devicePixelRatio = 2;
		await fixture.frame(200);
		assert.equal(fixture.paints, first + 2);
		await act(async () => fixture.root.render(<DynamicsActivityPanel readAnalysis={readAnalysis} copy={{}} audacity limiter />));
		await fixture.frame(240);
		assert.equal(fixture.paints, first + 3);
		idle = false; sequence++;
		await fixture.frame(280);
		assert.equal(fixture.paints, first + 4);
	} finally { await fixture.close(); }
	assert.equal(fixture.disconnected, true);
});

test('EQ reuses its pooled FFT intervals until width or native sample rate changes', async () => {
	const fixture = await canvasFixture();
	const originalFloor = Math.floor;
	let floors = 0;
	let nativeRate = 48_000;
	Math.floor = value => { floors++; return originalFloor(value); };
	function View(): React.ReactElement {
		const refs = useParametricEqSpectrum({ sampleRate: 48_000, showInput: true, showOutput: true,
			readSpectrum: (_source, values) => { values.fill(-120); values[128] = -12; return { sampleRate: nativeRate }; } });
		return <><canvas ref={refs.inputCanvasRef} /><canvas ref={refs.outputCanvasRef} /></>;
	}
	try {
		await act(async () => fixture.root.render(<View />));
		floors = 0;
		await fixture.frame(40);
		assert.ok(floors > 0);
		floors = 0;
		await fixture.frame(80);
		assert.equal(floors, 0, 'stable paints must reuse the already rounded FFT intervals');
		nativeRate = 44_100;
		await fixture.frame(120);
		assert.ok(floors > 0, 'the native FFT clock changes the frequency projection');
		floors = 0;
		fixture.resize();
		await fixture.frame(160);
		assert.ok(floors > 0, 'resizing rebuilds the frequency projection');
	} finally { Math.floor = originalFloor; await fixture.close(); }
});
