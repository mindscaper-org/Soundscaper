/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAudacityMacroEffectParameters } from '../src/common/editor/audacity-macro-commands.js';
import { createEffectMacroDraft, normalizeEffectMacroDraft, parseAudacityEffectMacro, serializeAudacityEffectMacro } from '../src/common/editor/effect-macros.js';
import { parseAudacityEffectPreset } from '../src/common/editor/audacity-effect-preset-import.ts';
import { applyAudacityAmplify } from '../src/common/editor/audacity-effects/basic.js';

const unsupported = /Amplify.*(clipping|batch)|clipping.*(macro|Amplify)/iu;
for (const gainDb of [-12, 0, 6]) test(`native macro export refuses the local no-clipping guard at ${String(gainDb)}dB`, () => {
	const draft = createEffectMacroDraft({ name: 'Guarded gain', effects: [{ type: 'audacity-amplify', params: { gainDb, allowClipping: false } }] });
	assert.throws(() => serializeAudacityEffectMacro(draft.effects), unsupported);
});

test('the native batch profile writes only Ratio when clipping is allowed', () => {
	assert.deepEqual(encodeAudacityMacroEffectParameters('audacity-amplify', { gainDb: 6, allowClipping: true }), [['Ratio', '1.9952623149688795']]);
	const draft = createEffectMacroDraft({ effects: [{ type: 'audacity-amplify', params: { gainDb: 6, allowClipping: true } }] });
	const text = serializeAudacityEffectMacro(draft.effects);
	assert.doesNotMatch(text, /AllowClipping/u);
	assert.deepEqual(parseAudacityEffectMacro(text).effects[0]?.params, { gainDb: 6, allowClipping: true });
});

test('bare native Ratio imports with its actual batch clipping policy', () => {
	assert.deepEqual(parseAudacityEffectMacro('Amplify:Ratio="2"').effects[0]?.params,
		{ gainDb: 6.0205999133, allowClipping: true });
});

test('local macro draft persistence and local guarded processing remain available', () => {
	const draft = createEffectMacroDraft({ name: 'Local guard', effects: [{ type: 'audacity-amplify', params: { gainDb: 6, allowClipping: false } }] });
	assert.deepEqual(normalizeEffectMacroDraft(JSON.parse(JSON.stringify(draft))).effects, draft.effects);
	const input = [Float32Array.from([0.8, 0.1])];
	assert.deepEqual(applyAudacityAmplify(input, 48000, draft.effects[0]?.params).map((channel: Float32Array) => Array.from(channel)), [[1, 0.125]]);
});

test('interactive native Amplify presets still retain their real no-clipping option', () => {
	assert.equal(parseAudacityEffectPreset('Amplify:Ratio="2" AllowClipping="0"', 'audacity-amplify').params.allowClipping, false);
});

test('a disabled local guard does not block an otherwise portable macro export', () => {
	const draft = createEffectMacroDraft({ effects: [{ type: 'audacity-amplify', enabled: false, params: { gainDb: 6, allowClipping: false } }, { type: 'audacity-fade-in' }] });
	assert.equal(serializeAudacityEffectMacro(draft.effects), 'FadeIn:\n');
});
