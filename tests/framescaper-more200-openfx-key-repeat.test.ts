/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOpenFxRepeatFixture } from './helpers/openfx-repeat-fixture.ts';
import { runOpenFxModifierFixture } from './helpers/openfx-modifier-fixture.ts';
import { cleanupOpenFxNativeContractFixture } from './helpers/openfx-native-scanner-fixture.js';
import type { OfxInteractEventV1 } from '../src/common/editor/native-ofx-host-contract.ts';

test.after(cleanupOpenFxNativeContractFixture);
for (const held of [true, false]) test(`native OpenFX distinguishes ${held ? 'held-key repeats' : 'separate key presses'}`, context => {
	const build = buildOpenFxRepeatFixture(context); if (!build) return;
	const events: OfxInteractEventV1[] = [{ kind: 'focus', sequence: 0, focused: true }];
	for (let index = 0; index < 3; index++) {
		events.push({ kind: 'keyboard', phase: 'down', sequence: events.length, key: 'ArrowRight', code: 'ArrowRight', modifiers: [] });
		if (!held) events.push({ kind: 'keyboard', phase: 'up', sequence: events.length, key: 'ArrowRight', code: 'ArrowRight', modifiers: [] });
	}
	events.push({ kind: 'focus', sequence: events.length, focused: false });
	const result = runOpenFxModifierFixture(build, events); assert.equal(result.status, 0, result.stderr);
	const response = JSON.parse(String(result.stdout)) as { parameterMutations: { parameter: { value: number } }[] };
	assert.equal(response.parameterMutations[0]?.parameter.value, held ? 24 : 6);
});


test('native focus loss retires held keys before a later focus session', context => {
	const build = buildOpenFxRepeatFixture(context); if (!build) return;
	const events: OfxInteractEventV1[] = [
		{ kind: 'focus', sequence: 0, focused: true },
		{ kind: 'keyboard', phase: 'down', sequence: 1, key: 'ArrowRight', code: 'ArrowRight', modifiers: [] },
		{ kind: 'focus', sequence: 2, focused: false },
		{ kind: 'focus', sequence: 3, focused: true },
		{ kind: 'keyboard', phase: 'down', sequence: 4, key: 'ArrowRight', code: 'ArrowRight', modifiers: [] },
		{ kind: 'focus', sequence: 5, focused: false },
	];
	const result = runOpenFxModifierFixture(build, events); assert.equal(result.status, 0, result.stderr);
	const response = JSON.parse(String(result.stdout)) as { parameterMutations: { parameter: { value: number } }[] };
	assert.equal(response.parameterMutations[0]?.parameter.value, 5);
});

test('different physical keys with the same logical key are independent initial presses', context => {
	const build = buildOpenFxRepeatFixture(context); if (!build) return;
	const result = runOpenFxModifierFixture(build, [
		{ kind: 'focus', sequence: 0, focused: true },
		{ kind: 'keyboard', phase: 'down', sequence: 1, key: 'ArrowRight', code: 'ArrowRight', modifiers: [] },
		{ kind: 'keyboard', phase: 'down', sequence: 2, key: 'ArrowRight', code: 'Numpad6', modifiers: [] },
	]);
	assert.equal(result.status, 0, result.stderr);
	const response = JSON.parse(String(result.stdout)) as { parameterMutations: { parameter: { value: number } }[] };
	assert.equal(response.parameterMutations[0]?.parameter.value, 5);
});
