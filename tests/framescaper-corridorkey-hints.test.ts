/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createChromaKeyMatte } from '../src/common/editor/video-chroma-key.ts';
import { CORRIDORKEY_CHROMA_HINT_DEFAULTS, normalizeCorridorKeyHintSettings } from '../src/common/editor/assistance/corridorkey-hint-settings.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

test('hint settings preserve the normal keyer defaults and reject unsupported or mutable settings', () => {
	const normal = createVideoEffect('chroma-key');
	for (const field of ['keyColor', 'similarity', 'softness'] as const) assert.equal(CORRIDORKEY_CHROMA_HINT_DEFAULTS[field], (normal.params as Record<string, number>)[field]);
	const input = { ...CORRIDORKEY_CHROMA_HINT_DEFAULTS };
	const accepted = normalizeCorridorKeyHintSettings(input); input.keyColor = 0x0000ff;
	assert.equal(accepted.hintMode === 'chroma-key' && accepted.keyColor, 0x00ff00); assert.ok(Object.isFrozen(accepted));
	assert.deepEqual(normalizeCorridorKeyHintSettings({ settingsVersion: 1, hintMode: 'none' }), { settingsVersion: 1, hintMode: 'none' });
	for (const invalid of [{ ...input, path: '/tmp/hint' }, { ...input, hintMode: 'unknown' }, { ...input, keyColor: -1 },
		{ ...input, similarity: 0 }, { ...input, softness: Number.NaN }, { ...input, hintQuality: 1.1 },
		{ settingsVersion: 1, hintMode: 'none', hintQuality: 0.75 }]) assert.throws(() => normalizeCorridorKeyHintSettings(invalid));
});

test('the normal Chroma Key prepass produces a soft matte without changing source RGB', () => {
	const width = 9; const height = 9;
	const rgba = new Uint8Array(width * height * 4);
	for (let index = 0; index < width * height; index += 1) rgba.set([0, 255, 0, 255], index * 4);
	for (let y = 3; y < 6; y += 1) for (let x = 3; x < 6; x += 1) rgba.set([255, 0, 0, 255], (y * width + x) * 4);
	const original = rgba.slice();
	const alpha = createChromaKeyMatte({ width, height, rgba }, { ...CORRIDORKEY_CHROMA_HINT_DEFAULTS, softness: 0.5 });
	assert.equal(alpha.length, width * height); assert.equal(alpha[0], 0);
	assert.ok(alpha[4 * width + 4]! > 0.8);
	assert.ok(alpha.some((value) => value > 0 && value < 1));
	assert.deepEqual(rgba, original);
});
