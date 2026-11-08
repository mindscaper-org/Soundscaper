/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffectMacroDraft, normalizeEffectMacroDraft, parseAudacityEffectMacro, serializeAudacityEffectMacro } from '../src/common/editor/effect-macros.js';
import { canEncodeAup4NativeRealtimeEffect } from '../src/common/editor/aup4-effect-profiles.js';
import { applyAudacityBrowserReverb } from '../src/common/editor/audacity-effects/reverb.js';
import { formatPresentationMessage, localizedErrorMessage } from '../src/common/i18n/presentation-message.ts';

for (const gain of ['wetGainDb', 'dryGainDb'] as const) for (const value of [-60, -20.1, 10.1, 12]) {
	test(`native Reverb macro refuses locally authored ${gain}=${String(value)}`, () => {
		const draft = createEffectMacroDraft({ effects: [{ type: 'audacity-reverb', params: { [gain]: value } }] });
		assert.equal(canEncodeAup4NativeRealtimeEffect(draft.effects[0]), false, 'the existing native profile rejects these gains');
		assert.throws(() => serializeAudacityEffectMacro(draft.effects), (error: unknown) => {
			assert.ok(error instanceof RangeError);
			const message = localizedErrorMessage(error); assert.ok(message);
			assert.equal(message.key, 'parameterRangeError');
			assert.equal(formatPresentationMessage({ parameterRangeError: '{label}: {minimum}..{maximum}' }, message),
				'Audacity Reverb WetGain / DryGain (dB): -20..10');
			return true;
		});
	});
}

for (const wetGainDb of [-20, 10]) for (const dryGainDb of [-20, 10]) {
	test(`native Reverb gain boundaries roundtrip wet=${String(wetGainDb)} dry=${String(dryGainDb)}`, () => {
		const draft = createEffectMacroDraft({ effects: [{ type: 'audacity-reverb', params: { wetGainDb, dryGainDb } }] });
		assert.equal(canEncodeAup4NativeRealtimeEffect(draft.effects[0]), true);
		const text = serializeAudacityEffectMacro(draft.effects);
		assert.match(text, new RegExp(`WetGain="${String(wetGainDb)}"`, 'u'));
		assert.match(text, new RegExp(`DryGain="${String(dryGainDb)}"`, 'u'));
		assert.deepEqual(parseAudacityEffectMacro(text).effects[0]?.params, draft.effects[0]?.params);
	});
}

test('wider local Reverb gains retain their draft and actual local processing', () => {
	const draft = createEffectMacroDraft({ name: 'Local Reverb', effects: [{ type: 'audacity-reverb', params: { preDelay: 200, dryGainDb: 12 } }] });
	assert.deepEqual(normalizeEffectMacroDraft(JSON.parse(JSON.stringify(draft))).effects, draft.effects);
	const input = [new Float32Array(4800).fill(.05)];
	const output = applyAudacityBrowserReverb(input, 48000, draft.effects[0]?.params);
	assert.ok(output[0]);
	assert.ok(Math.abs(output[0][100] - .05 * 10 ** (12 / 20)) < 1e-6);
	assert.equal(input[0]?.[100], Math.fround(.05));
});

test('disabled wide Reverb does not prevent healthy native macro delivery', () => {
	const draft = createEffectMacroDraft({ effects: [{ type: 'audacity-reverb', enabled: false, params: { dryGainDb: 12 } }, { type: 'audacity-fade-in' }] });
	assert.equal(serializeAudacityEffectMacro(draft.effects), 'FadeIn:\n');
});
