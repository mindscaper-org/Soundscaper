/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { VIDEO_EFFECT_TYPES, videoEffectDefaults, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { videoEffectPasses } from '../src/common/editor/ui/video-preview-effects.js';
import { PARITY_CASES, SCALED_PARITY_CASES, DEVELOP_ACTIVE_PARITY_CASES } from './browser/video-effect-parity-cases.ts';

const FIRST = ['color-adjust', 'pixelate', 'vignette', 'gaussian-blur', 'sharpen', 'rgb-split'];
const SECOND = ['chroma-key', 'luma-key', 'spill-suppression', 'glow', 'outline', 'drop-shadow'];
const LEGACY = new Set([...FIRST, ...SECOND]);

test('calibrated legacy batches retain their exact six-effect recipes when the registry grows', () => {
	for (const [name, expected] of [['first-batch-default-stack', FIRST], ['second-batch-default-stack', SECOND]] as const) {
		const parity = PARITY_CASES.find(row => row.name === name);
		assert.ok(parity);
		assert.deepEqual(parity.effects.map(row => row.type), expected);
		for (const effect of parity.effects) assert.deepEqual(effect.params, videoEffectDefaults(effect.type));
	}
});

test('every registered develop effect owns an individual active preview and FFmpeg parity recipe', () => {
	const expected = VIDEO_EFFECT_TYPES.filter(type => !LEGACY.has(type)).sort();
	assert.deepEqual(DEVELOP_ACTIVE_PARITY_CASES.map(row => row.effects[0]?.type).sort(), expected);
	assert.equal(new Set(DEVELOP_ACTIVE_PARITY_CASES.map(row => row.name)).size, expected.length);
	for (const parity of DEVELOP_ACTIVE_PARITY_CASES) {
		assert.equal(parity.effects.length, 1, parity.name);
		const effect = parity.effects[0]; assert.ok(effect);
		assert.equal(effect.enabled, true);
		assert.ok(videoEffectPasses(effect).length > 0, `${parity.name}: no active native preview pass`);
		assert.ok(serializeVideoEffectsToFfmpegOperations(parity.effects).length > 0, `${parity.name}: no owning FFmpeg operation`);
		assert.ok(PARITY_CASES.includes(parity), `${parity.name}: active recipe is not executed by the browser spec`);
	}
});

test('all previous default scaled single-effect cases remain and the registry inventory is closed', () => {
	for (const type of VIDEO_EFFECT_TYPES.filter(type => !FIRST.includes(type))) {
		const scaled = SCALED_PARITY_CASES.find(([name]) => name === `scaled-letterboxed-${type}`);
		assert.ok(scaled, type); assert.equal(scaled[1].length, 1);
		assert.equal(scaled[1][0]?.type, type);
		assert.deepEqual(scaled[1][0]?.params, videoEffectDefaults(type));
	}
	assert.deepEqual([...new Set([...FIRST, ...SECOND, ...DEVELOP_ACTIVE_PARITY_CASES.map(row => row.effects[0]?.type)])].sort(),
		[...VIDEO_EFFECT_TYPES].sort());
});
