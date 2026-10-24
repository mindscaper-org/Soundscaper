/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { paintWaveformSelectionLayers, releaseWaveformSelectionLayers } from '../src/common/editor/ui/timeline/waveform-selection-layers.ts';

function fixture(width = 100, backingWidth = 100) {
	const surfaces: Array<{ width: number; height: number }> = [];
	const renders: boolean[] = [];
	const copies: unknown[][] = [];
	const cleared: number[][] = [];
	const edges: unknown[] = [];
	const owner = { width: backingWidth, height: 80, ownerDocument: { createElement() {
		const surface = { width: 0, height: 0 }; surfaces.push(surface); return surface;
	} } } as unknown as HTMLCanvasElement;
	const context = { canvas: owner, save() {}, restore() {}, setTransform() {}, beginPath() {}, rect() {}, clip() {},
		drawImage(...args: unknown[]) { copies.push(args); }, clearRect(...args: number[]) { cleared.push(args); } } as unknown as CanvasRenderingContext2D;
	const key = [{}];
	const paint = (start: number, end: number, revision: readonly unknown[] = key) => paintWaveformSelectionLayers(context, {
		key: revision, width, start, end,
		draw(_surface, selected) { renders.push(selected); return true; },
		drawEdges(_surface, ranges) { edges.push(ranges); return true; },
	});
	return { owner, context, surfaces, renders, copies, cleared, edges, paint };
}

void test('fully selected cold waveform paints one needed layer and lazily acquires its base', () => {
	const value = fixture();
	try {
		assert.equal(value.paint(0, 100), true);
		assert.deepEqual(value.renders, [true], 'the hidden base must not scan the complete waveform');
		assert.equal(value.copies.length, 1, 'the selected image is copied directly without an overwritten base');
		assert.equal(value.cleared.length, 1);
		assert.equal(value.surfaces.length, 1);
		assert.equal(value.paint(0, 100), true);
		assert.deepEqual(value.renders, [true]);
		assert.equal(value.paint(10, 80), true);
		assert.deepEqual(value.renders, [true, false], 'a later partial selection materializes the base once');
		assert.equal(value.surfaces.length, 2);
		assert.equal(value.paint(-1, -1), true);
		assert.deepEqual(value.renders, [true, false]);
	} finally { releaseWaveformSelectionLayers(value.owner); }
	assert.ok(value.surfaces.every(surface => surface.width === 0 && surface.height === 0));
});

void test('dense and fractional-width waveforms reuse layers in backing pixels', () => {
	for (const [width, backingWidth] of [[100, 200], [100, 125], [100.25, 201]]) {
		const value = fixture(width, backingWidth);
		try {
			assert.equal(value.paint(0, width), true);
			assert.deepEqual(value.renders, [true]);
			assert.equal(value.paint(10.25, 80.75), true);
			assert.deepEqual(value.renders, [true, false]);
			assert.equal(value.paint(11.5, 79.5), true);
			assert.deepEqual(value.renders, [true, false], 'moving selection never rebuilds either layer');
			assert.ok(value.surfaces.every(surface => surface.width === backingWidth));
			assert.ok(value.cleared.every(([start, , size]) => start! >= 0 && start! + size! <= backingWidth));
		} finally { releaseWaveformSelectionLayers(value.owner); }
		assert.ok(value.surfaces.every(surface => surface.width === 0 && surface.height === 0));
	}
});

void test('the pixel budget admits all three surfaces together or allocates nothing', () => {
	const value = fixture(100, 40_000);
	try {
		assert.equal(value.paint(10.25, 80.75), false);
		assert.deepEqual(value.surfaces, [], 'base, selected and edge scratch exceed the shared 32 MiB budget');
	} finally { releaseWaveformSelectionLayers(value.owner); }
});

void test('unselected and fractional-only cold waveforms retain one base and no selected layer', () => {
	const value = fixture();
	try {
		assert.equal(value.paint(-1, -1), true);
		assert.deepEqual(value.renders, [false]);
		assert.equal(value.paint(0.25, 0.5), true);
		assert.deepEqual(value.renders, [false]);
		assert.deepEqual(value.edges, [[{ start: 0, end: 1 }]]);
		assert.equal(value.paint(0, 100), true);
		assert.deepEqual(value.renders, [false, true]);
	} finally { releaseWaveformSelectionLayers(value.owner); }
});

void test('cold partial selections still acquire both layers and source or palette changes release them', () => {
	const value = fixture();
	try {
		assert.equal(value.paint(10, 80), true);
		assert.deepEqual(value.renders, [false, true]);
		assert.equal(value.paint(0, 100, [{}]), true);
		assert.deepEqual(value.renders, [false, true, true]);
		assert.ok(value.surfaces.slice(0, 2).every(surface => surface.width === 0 && surface.height === 0));
		assert.equal(value.surfaces.at(-1)!.width, 100);
	} finally { releaseWaveformSelectionLayers(value.owner); }
});
