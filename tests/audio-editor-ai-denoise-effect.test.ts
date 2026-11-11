/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { audioEffectLabel, audioEffectTypes, createEffect, normalizeEffect } from '../src/common/editor/effects.js';
import { effectLatencyFrames, effectRackLatencyFrames } from '../src/common/editor/engine/effect-rack.ts';
import { aiDenoiseGeometry, aiDenoiseRackGeometry, aiDenoiseLatencyFrames, aiDenoiseRequest } from '../src/common/editor/first-party-effects/ai-denoise/contract.ts';
import { assertStandardRackEffectConfiguration } from '../src/common/editor/controller/effects/internal/rack-standard-effect-admission.ts';
import { projectUsesAiDenoise } from '../src/common/editor/engine/ai-denoise-node.ts';

test('AI denoising survives JSON round trips with fixed PDC and ordinary rack bypass', () => {
	const effect = createEffect('ai-denoise', { id: 'denoiser' });
	assert.equal(audioEffectLabel('ai-denoise'), 'AI denoising (DPDFNet2)');
	assert.ok(audioEffectTypes().includes('ai-denoise'));
	assert.deepEqual(normalizeEffect(JSON.parse(JSON.stringify(effect))), effect);
	assert.equal(effectLatencyFrames(effect, 48000), 4096);
	assert.equal(effectRackLatencyFrames([effect, { ...effect, enabled: false }], 48000), 4096);
	assert.equal(projectUsesAiDenoise({ tracks: [{ effects: [effect] }] }), true);
	assert.equal(projectUsesAiDenoise({ tracks: [{ effectsActive: false, effects: [effect] }] }), false);
	assert.equal(projectUsesAiDenoise({ master: { effects: [{ ...effect, bypassed: true }] } }), false);
	const selected = { tracks: [{ id: 'voice', effects: [effect] }, { id: 'music' }], master: { effects: [effect] } };
	assert.equal(projectUsesAiDenoise(selected, { trackId: 'music', includeMaster: false }), false);
	assert.equal(projectUsesAiDenoise(selected, { trackId: 'voice', includeMaster: false }), true);
});
test('stream admission retains its fixed rate, channel and closed-request limits', () => {
	assert.doesNotThrow(() => aiDenoiseGeometry(48000, 2));
	assert.throws(() => aiDenoiseGeometry(44100, 2));
	assert.throws(() => aiDenoiseGeometry(48000, 6));
	assert.throws(() => aiDenoiseRequest({ sessionId: '1'.repeat(40), sampleRate: 48000, channelCount: 2, path: '/tmp/model' }));
});

test('rack admission accepts project rates and compensates both resamplers while native grants stay at 48 kHz', () => {
	const effect = createEffect('ai-denoise');
	for (const [rate, latency] of [[8000, 731], [16000, 1414], [44100, 3813], [48000, 4096], [96000, 8288], [192000, 16576], [768000, 66304]]) {
		assert.doesNotThrow(() => aiDenoiseRackGeometry(rate!, 2));
		assert.doesNotThrow(() => assertStandardRackEffectConfiguration({ id: 'rates', sampleRate: rate!, tracks: [] }, 'master', null, effect));
		assert.equal(aiDenoiseLatencyFrames(rate!), latency);
		assert.equal(effectLatencyFrames(effect, rate!), latency);
	}
	assert.throws(() => aiDenoiseRequest({ sessionId: '1'.repeat(40), sampleRate: 44100, channelCount: 2 }));
	for (const rate of [0, NaN, 7999, 768001]) assert.throws(() => aiDenoiseRackGeometry(rate, 1));
	assert.throws(() => aiDenoiseRackGeometry(44100, 6));
});
