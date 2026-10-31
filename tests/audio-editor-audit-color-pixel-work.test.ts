/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gradeUnifiedExactLinearSourceFrame } from '../src/common/editor/unified-exact-linear-source-frame.ts';
import { prepareManagedSdrGradeStackV1, applyPreparedManagedSdrGradeStackLinearChannelsV1,
	defaultVideoSourceColorInterpretationV1 } from '../src/common/editor/video-color-management-v27.ts';
import { parseCubeLutV1, sampleCubeLut } from '../src/common/imaging/cube-lut-v1.ts';

test('ungraded byte frames reuse the finite transfer palette with exact Float32 output', () => {
	const pixels = Uint8Array.from({ length: 4_096 }, (_, index) => (index * 23 + Math.floor(index / 4)) % 256);
	for (const decoding of ['file', 'canvas-readback', 'linear'] as const) for (const sourceKind of ['still', 'video'] as const) {
		const prepared = prepareManagedSdrGradeStackV1({ decoding, grades: [],
			interpretation: defaultVideoSourceColorInterpretationV1(sourceKind, 'source') });
		const expected = new Float32Array(pixels.length);
		for (let offset = 0; offset < pixels.length; offset += 4) expected.set(applyPreparedManagedSdrGradeStackLinearChannelsV1(
			prepared, pixels[offset]! / 255, pixels[offset + 1]! / 255, pixels[offset + 2]! / 255, pixels[offset + 3]! / 255), offset);
		let reads = 0;
		const counted = new Proxy(prepared, { get(target, key, receiver) {
			if (key === 'transfer') reads++; return Reflect.get(target, key, receiver) as unknown;
		} });
		assert.deepEqual(gradeUnifiedExactLinearSourceFrame(counted, { width: 64, height: 16, pixels }).pixels, expected);
		assert.ok(reads <= 768, `${reads} per-pixel transfer decodes`);
	}
});

test('LUT lattice interpolation preserves all pixels without per-axis frozen records', () => {
	const lut = parseCubeLutV1('LUT_3D_SIZE 2\nDOMAIN_MIN -0.1 0 0.1\nDOMAIN_MAX 1 1.2 0.9\n'
		+ '0 0 0\n1 0.1 0\n0.2 1 0\n1 1 0.1\n0 0.1 1\n1 0.2 1\n0.2 1 1\n1 1 1');
	const freeze = Object.freeze;
	let records = 0;
	Object.freeze = ((value: unknown) => {
		if (value && typeof value === 'object' && Object.hasOwn(value, 'low')) records++;
		return freeze(value);
	}) as typeof Object.freeze;
	const output: number[] = [];
	try {
		for (let index = 0; index < 256; index++) output.push(...sampleCubeLut(lut, [index / 255, (255 - index) / 255, (index % 37) / 36]));
	} finally { Object.freeze = freeze; }
	assert.equal(createHash('sha256').update(JSON.stringify(output)).digest('hex'), '1eb9d4ff17f41263c4ee7d8a442c69798109ecfe309d5ceee2f9f4a7c165f692');
	assert.equal(records, 0);
});

test('nonlinear color grades retain exact pixels without temporary RGB map arrays', () => {
	const prepared = prepareManagedSdrGradeStackV1({ decoding: 'linear', grades: [{ schemaVersion: 1,
		exposureStops: 0.75, contrast: 1.2, pivot: 0.18, lift: [0.03, -0.02, 0.01],
		gamma: [0.9, 1.1, 1.2], gain: [1.1, 0.9, 1.2], saturation: 0.7, lut: null }] });
	const pixels = Float32Array.from({ length: 4_096 }, (_, index) => (index * 23 + Math.floor(index / 4)) % 256 / 255);
	const map = Array.prototype.map;
	let rgbMaps = 0;
	Object.defineProperty(Array.prototype, 'map', { configurable: true, writable: true,
		value(this: unknown[], callback: (value: unknown, index: number, values: unknown[]) => unknown, receiver?: unknown) {
			if (this.length === 3 && this.every(value => typeof value === 'number')) rgbMaps++;
			return map.call(this, callback, receiver);
		} });
	let output: Float32Array;
	try { output = gradeUnifiedExactLinearSourceFrame(prepared, { width: 64, height: 16, pixels }).pixels; }
	finally { Object.defineProperty(Array.prototype, 'map', { configurable: true, writable: true, value: map }); }
	assert.equal(createHash('sha256').update(new Uint8Array(output.buffer)).digest('hex'), 'f3e20b510234da9d4a655b6755d89e636721588db829ff40193c91332e1d2e0f');
	assert.equal(rgbMaps, 0);
});
