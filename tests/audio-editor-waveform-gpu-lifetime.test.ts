/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireWaveformGpuRenderer } from '../src/common/editor/controller/source/waveform-gpu-renderer.ts';

test('rows share one context and release unavailable GPU resources exactly once', () => {
	const surfaces: Array<EventTarget & { width: number; height: number }> = [];
	const owner = {};
	const createCanvas = () => {
		const surface = Object.assign(new EventTarget(), { width: 300, height: 150, getContext: () => null });
		surfaces.push(surface); return surface as unknown as HTMLCanvasElement;
	};
	const first = acquireWaveformGpuRenderer(owner, createCanvas, () => {});
	const second = acquireWaveformGpuRenderer(owner, createCanvas, () => {});
	assert.equal(surfaces.length, 1);
	const context = { canvas: { width: 100, height: 80 } } as CanvasRenderingContext2D;
	const plan = { mode: 'summary', channels: [] };
	const options = { channel: 0, width: 100, centerY: 40, maxAmplitude: 38, pixelRatioX: 1, pixelRatioY: 1,
		channelTop: 0, channelHeight: 80, showRms: false, selectionStart: -1, selectionEnd: -1,
		baseSampleColor: '#000', selectedSampleColor: '#000', baseRmsColor: '#000', selectedRmsColor: '#000' };
	assert.equal(first.draw(context, plan, options), false);
	first.release(); first.release();
	assert.equal(surfaces[0]?.width, 300);
	assert.equal(second.draw(context, plan, options), false);
	second.release();
	assert.equal(surfaces[0]?.width, 0);
	assert.equal(second.draw(context, plan, options), false);
	const third = acquireWaveformGpuRenderer(owner, createCanvas, () => {});
	assert.equal(surfaces.length, 2);
	third.release();
	assert.ok(surfaces.every(surface => surface.width === 0 && surface.height === 0));
});

test('direct displays refuse excess contexts and pixels before allocating, and release their slots', () => {
	for (const large of [false, true]) {
		const surfaces: Array<EventTarget & { width: number; height: number; removed: boolean }> = [];
		const createCanvas = () => Object.assign(new EventTarget(), { width: 0, height: 0, getContext: () => null }) as unknown as HTMLCanvasElement;
		const lease = acquireWaveformGpuRenderer({}, createCanvas, () => {}, () => {
			const surface = Object.assign(new EventTarget(), { width: 1, height: 1, removed: false, style: { visibility: '' },
				getContext: () => null, remove() { this.removed = true; } });
			surfaces.push(surface); return surface as unknown as HTMLCanvasElement;
		});
		const canvases = Array.from({ length: large ? 3 : 9 }, () => ({ width: large ? 2_048 : 100, height: large ? 2_048 : 80 }) as HTMLCanvasElement);
		const plan = { mode: 'summary', channels: [] };
		for (const canvas of canvases) assert.equal(lease.drawFrame({ canvas } as CanvasRenderingContext2D, plan, []), false);
		assert.equal(surfaces.length, large ? 2 : 8);
		lease.releaseOwner(canvases[0]!);
		assert.equal(surfaces[0]?.removed, true);
		assert.equal(lease.drawFrame({ canvas: canvases.at(-1)! } as CanvasRenderingContext2D, plan, []), false);
		assert.equal(surfaces.length, large ? 3 : 9);
		lease.release();
		assert.ok(surfaces.every(surface => surface.removed && surface.width === 0 && surface.height === 0));
	}
});

test('a shared direct display stays alive until its last row lease releases it', () => {
	const surfaces: Array<{ removed: boolean }> = [];
	const createCanvas = () => Object.assign(new EventTarget(), { width: 0, height: 0, getContext: () => null }) as unknown as HTMLCanvasElement;
	const createDisplay = () => {
		const surface = Object.assign(new EventTarget(), { width: 1, height: 1, removed: false, style: { visibility: '' },
			getContext: () => null, remove() { this.removed = true; } });
		surfaces.push(surface); return surface as unknown as HTMLCanvasElement;
	};
	const owner = {};
	const first = acquireWaveformGpuRenderer(owner, createCanvas, () => {}, createDisplay);
	const second = acquireWaveformGpuRenderer(owner, createCanvas, () => {}, createDisplay);
	const canvas = { width: 100, height: 80 } as HTMLCanvasElement;
	const context = { canvas } as CanvasRenderingContext2D;
	first.drawFrame(context, { mode: 'summary', channels: [] }, []);
	second.drawFrame(context, { mode: 'summary', channels: [] }, []);
	assert.equal(surfaces.length, 1);
	first.release();
	assert.equal(surfaces[0]?.removed, false);
	second.releaseOwner(canvas);
	assert.equal(surfaces[0]?.removed, true);
	second.release();
});
