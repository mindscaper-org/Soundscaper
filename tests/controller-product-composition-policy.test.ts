/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { FRAMESCAPER_PROFILE, SOUNDSCAPER_PROFILE } from '../src/common/product-profiles.js';
import { resolveProductCompositionDecision } from '../src/common/editor/controller/composition/product-composition-policy.ts';

test('Soundscaper composes every optional audio subsystem domain', () => {
	const decision = resolveProductCompositionDecision(SOUNDSCAPER_PROFILE);
	assert.deepEqual({ ...decision }, {
		recording: true,
		generators: true,
		labeledAudio: true,
		effects: true,
		spectral: true,
		analysis: true,
		macros: true,
		selectionEffectWorkers: true,
	});
});

test('Framescaper composes no optional audio subsystem domain', () => {
	const decision = resolveProductCompositionDecision(FRAMESCAPER_PROFILE);
	assert.deepEqual({ ...decision }, {
		recording: false,
		generators: false,
		labeledAudio: false,
		effects: false,
		spectral: false,
		analysis: false,
		macros: false,
		selectionEffectWorkers: false,
	});
});
