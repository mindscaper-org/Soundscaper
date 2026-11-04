/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { compositeNormalLinearPixels } from '../src/common/editor/unified-exact-linear-normal-composition.ts';
import {
	compositeUnifiedExactLinearFrameV13,
	type UnifiedExactLinearPremultipliedFrameV13,
} from '../src/common/editor/unified-exact-linear-rgba-v13.ts';

const MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'exclusion', 'add'] as const;

test('normal composition reads each target channel once without calculating an unused backdrop', () => {
	const target = frame(0), source = frame(1);
	let reads = 0;
	const counted = new Proxy(target.pixels, {
		get(pixels, key) {
			if (typeof key === 'string' && /^\d+$/u.test(key)) reads += 1;
			return Reflect.get(pixels, key, pixels) as unknown;
		},
		set(pixels, key, value: unknown) { return Reflect.set(pixels, key, value, pixels); },
	});
	compositeNormalLinearPixels(counted, source.pixels);
	assert.equal(reads, target.pixels.length);
});

test('all composition modes retain every Float64 bit across mixed, opaque and transparent alpha', () => {
	const digest = createHash('sha256');
	const bytes = Buffer.alloc(8);
	for (const mode of MODES) for (let variant = 0; variant < 24; variant += 1) {
		const target = frame(variant), source = frame(variant + 1);
		compositeUnifiedExactLinearFrameV13(target, source, mode);
		for (const channel of target.pixels) {
			bytes.writeDoubleLE(channel);
			digest.update(bytes);
		}
	}
	// Recorded from the original all-mode compositor before normal specialization.
	assert.equal(digest.digest('hex'), 'ea570cd779864ec962bb799457309f7e839c2942c398eabca6f6638b22f80a61');
});

test('native normal composition and its admitted pixel kernel agree without mutating the source', () => {
	for (let variant = 0; variant < 24; variant += 1) {
		const target = frame(variant), source = frame(variant + 1);
		const expected = target.pixels.slice(), originalSource = source.pixels.slice();
		compositeNormalLinearPixels(expected, source.pixels);
		compositeUnifiedExactLinearFrameV13(target, source, 'normal');
		assert.deepEqual(target.pixels, expected);
		assert.deepEqual(source.pixels, originalSource);
	}
});

test('normal composition retains aliasing and live custom field reads', () => {
	for (const alias of [false, true]) {
		const target = frame(2), source = alias ? target : frame(3);
		let targetReads = 0, sourceReads = 0;
		const observedTarget = { width: target.width, height: target.height,
			get pixels() { targetReads += 1; return target.pixels; } };
		const observedSource = alias ? observedTarget : { width: source.width, height: source.height,
			get pixels() { sourceReads += 1; return source.pixels; } };
		const expected = frame(2), expectedSource = alias ? expected : frame(3);
		compositeUnifiedExactLinearFrameV13(expected, expectedSource, 'normal');
		compositeUnifiedExactLinearFrameV13(observedTarget, observedSource, 'normal');
		assert.deepEqual(target.pixels, expected.pixels);
		assert.equal(targetReads, alias ? 207 : 168);
		assert.equal(sourceReads, alias ? 0 : 66);
	}
});

test('proxy-backed working planes retain the generic compositor reads', () => {
	const target = frame(0), source = frame(1);
	let reads = 0;
	const counted = new Proxy(target.pixels, {
		get(pixels, key) {
			if (typeof key === 'string' && /^\d+$/u.test(key)) reads += 1;
			return Reflect.get(pixels, key, pixels) as unknown;
		},
		set(pixels, key, value: unknown) { return Reflect.set(pixels, key, value, pixels); },
	});
	const expected = frame(0);
	compositeUnifiedExactLinearFrameV13(expected, source, 'normal');
	compositeUnifiedExactLinearFrameV13({ ...target, pixels: counted }, source, 'normal');
	assert.deepEqual(target.pixels, expected.pixels);
	assert.equal(reads, 112);
});

test('normal specialization retains working-plane geometry admission', () => {
	const target = frame(0), source = frame(1);
	assert.throws(() => compositeUnifiedExactLinearFrameV13(target, { ...source, width: 3 }, 'normal'), /geometry/u);
	assert.throws(() => compositeUnifiedExactLinearFrameV13(target, {
		...source, pixels: new Float64Array(3),
	}, 'normal'), /geometry/u);
});

test('normal composition retains aliased and overlapping plane traversal with exceptional channels', () => {
	const digest = createHash('sha256');
	for (const shift of [-4, 0, 4]) for (let variant = 0; variant < 4; variant += 1) {
		const backing = new Float64Array(68);
		const values = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 0, 1, 0.5, 1e-13];
		for (let index = 0; index < backing.length; index += 1) {
			backing[index] = values[(index + variant) % values.length]!;
		}
		const target = { width: 4, height: 4, pixels: backing.subarray(shift < 0 ? 4 : 0, shift < 0 ? 68 : 64) };
		const source = { width: 4, height: 4, pixels: backing.subarray(shift > 0 ? 4 : 0, shift > 0 ? 68 : 64) };
		compositeUnifiedExactLinearFrameV13(target, source, 'normal');
		digest.update(new Uint8Array(backing.buffer));
	}
	assert.equal(digest.digest('hex'), '273859a209b2e62631c5eb325b5cd4f0f6097f4dc3435a8fae8d53a4fef7c654');
});

test('unsupported runtime modes retain the existing normal-color fallback', () => {
	const target = frame(2), expected = frame(2), source = frame(0);
	compositeUnifiedExactLinearFrameV13(expected, source, 'normal');
	Reflect.apply(compositeUnifiedExactLinearFrameV13, undefined, [target, source, 'unsupported-mode']);
	assert.deepEqual(target.pixels, expected.pixels);
});

function frame(variant: number): UnifiedExactLinearPremultipliedFrameV13 {
	const pixels = new Float64Array(4 * 4 * 4);
	const alphas = variant % 3 === 0 ? [1] : variant % 3 === 1 ? [0] : [0, 1, 0.5, 1e-13, 1e-10, 1e-12, -0];
	for (let offset = 0; offset < pixels.length; offset += 4) {
		const alpha = alphas[(offset / 4) % alphas.length]!;
		for (let channel = 0; channel < 3; channel += 1) {
			pixels[offset + channel] = ((offset * 73 + channel * 19 + variant * 29) % 256) / 255 * alpha;
		}
		pixels[offset + 3] = alpha;
	}
	return { width: 4, height: 4, pixels };
}
