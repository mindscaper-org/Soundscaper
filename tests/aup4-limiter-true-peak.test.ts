/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect } from '../src/common/editor/effects.js';
import { canEncodeAup4NativeRealtimeEffect } from '../src/common/editor/aup4-effect-profiles.js';
import { createAup4EffectsNode, readAup4EffectsNode } from '../src/common/editor/aup4-effects.js';
import { encodeAudacityMacroEffectParameters } from '../src/common/editor/audacity-macro-commands.js';

test('the default limiter remains native-compatible while true peak settings survive portable AUP4', () => {
	const native = createEffect('audacity-limiter');
	assert.equal(canEncodeAup4NativeRealtimeEffect(native), true);
	const truePeak = createEffect('audacity-limiter', { params: { limitTruePeaks: true } });
	assert.equal(canEncodeAup4NativeRealtimeEffect(truePeak), false);
	const [reopened] = readAup4EffectsNode(createAup4EffectsNode([truePeak]));
	assert.equal(reopened.type, 'audacity-limiter');
	assert.equal(reopened.params.limitTruePeaks, true);
});

test('native Audacity macro export refuses to discard true peak processing', () => {
	assert.throws(() => encodeAudacityMacroEffectParameters('audacity-limiter', { limitTruePeaks: true }), /true peak/iu);
});
