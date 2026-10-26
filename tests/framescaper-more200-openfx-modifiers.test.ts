/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { OfxInteractEventV1 } from '../src/common/editor/native-ofx-host-contract.ts';
import { buildOpenFxModifierFixture, runOpenFxModifierFixture } from './helpers/openfx-modifier-fixture.ts';
import { cleanupOpenFxNativeContractFixture } from './helpers/openfx-native-scanner-fixture.js';

test.after(cleanupOpenFxNativeContractFixture);
const names = ['alt', 'control', 'meta', 'shift'] as const;
for (const modifier of names) for (const mode of ['preheld', 'focused'] as const) {
	test(`the native OpenFX interact receives ${mode} ${modifier}`, context => {
		const build = buildOpenFxModifierFixture(context);
		if (!build) return;
		const code = { alt: 'AltLeft', control: 'ControlRight', meta: 'MetaLeft', shift: 'ShiftRight' }[modifier];
		const key = { alt: 'Alt', control: 'Control', meta: 'Meta', shift: 'Shift' }[modifier];
		const events: OfxInteractEventV1[] = [{ kind: 'focus', sequence: 0, focused: true }];
		if (mode === 'focused') events.push({ kind: 'keyboard', phase: 'down', sequence: events.length,
			key, code, modifiers: [modifier] });
		for (const phase of ['down', 'motion', 'up'] as const) events.push({
			kind: 'pointer', phase, sequence: events.length, x: 0.25, y: 0.5, button: 1,
			modifiers: phase === 'up' && mode === 'preheld' ? [] : [modifier],
		});
		if (mode === 'focused') events.push({ kind: 'keyboard', phase: 'up', sequence: events.length,
			key, code, modifiers: [] });
		events.push({ kind: 'keyboard', phase: 'down', sequence: events.length,
			key: 'Enter', code: 'Enter', modifiers: [] });
		events.push({ kind: 'keyboard', phase: 'up', sequence: events.length,
			key: 'Enter', code: 'Enter', modifiers: [] });
		events.push({ kind: 'focus', sequence: events.length, focused: false });
		const result = runOpenFxModifierFixture(build, events);
		assert.equal(result.status, 0, result.stderr);
		const response = JSON.parse(String(result.stdout)) as { parameterMutations: unknown[]; acceptedSequences: number[] };
		assert.deepEqual(response.acceptedSequences, events.map(event => event.sequence),
			'internal modifier synchronization does not mint input sequence numbers');
		assert.deepEqual(response.parameterMutations, [{ parameter: { name: 'parameter0', type: 'integer',
			value: 42, keyframes: [{ frame: 12, value: 9 }] } }]);
	});
}


test('an unmodified native gesture remains unmodified', context => {
	const build = buildOpenFxModifierFixture(context);
	if (!build) return;
	const result = runOpenFxModifierFixture(build, [
		{ kind: 'focus', sequence: 0, focused: true },
		{ kind: 'pointer', phase: 'down', sequence: 1, x: 0.25, y: 0.5, button: 1, modifiers: [] },
	]);
	assert.notEqual(result.status, 0, 'the modifier-sensitive plug-in must refuse this control');
	assert.match(String(result.stderr), /Interact failed its DrawSuite/u);
});

test('focus loss releases a modifier held before focus without a canvas keyup', context => {
	const build = buildOpenFxModifierFixture(context);
	if (!build) return;
	const events: OfxInteractEventV1[] = [
		{ kind: 'focus', sequence: 0, focused: true },
		{ kind: 'pointer', phase: 'down', sequence: 1, x: 0.25, y: 0.5, button: 1, modifiers: ['shift'] },
		{ kind: 'pointer', phase: 'motion', sequence: 2, x: 0.25, y: 0.5, button: 1, modifiers: ['shift'] },
		{ kind: 'pointer', phase: 'up', sequence: 3, x: 0.25, y: 0.5, button: 1, modifiers: ['shift'] },
		{ kind: 'keyboard', phase: 'down', sequence: 4, key: 'Enter', code: 'Enter', modifiers: ['shift'] },
		{ kind: 'keyboard', phase: 'up', sequence: 5, key: 'Enter', code: 'Enter', modifiers: ['shift'] },
		{ kind: 'focus', sequence: 6, focused: false },
	];
	const result = runOpenFxModifierFixture(build, events);
	assert.equal(result.status, 0, result.stderr);
});


for (const otherHeld of [false, true]) test(`preheld modifier release preserves the immediate draw state (other side held: ${String(otherHeld)})`, context => {
	const build = buildOpenFxModifierFixture(context);
	if (!build) return;
	const events: OfxInteractEventV1[] = [
		{ kind: 'focus', sequence: 0, focused: true },
		{ kind: 'pointer', phase: 'down', sequence: 1, x: 0.25, y: 0.5, button: 1, modifiers: ['shift'] },
		{ kind: 'pointer', phase: 'motion', sequence: 2, x: 0.25, y: 0.5, button: 1, modifiers: ['shift'] },
		{ kind: 'pointer', phase: 'up', sequence: 3, x: 0.25, y: 0.5, button: 1, modifiers: ['shift'] },
		{ kind: 'keyboard', phase: 'up', sequence: 4, key: 'Shift', code: otherHeld ? 'ShiftLeft' : 'ShiftRight',
			modifiers: otherHeld ? ['shift'] : [] },
	];
	const result = runOpenFxModifierFixture(build, events);
	assert.equal(result.status, 0, result.stderr);
	const response = JSON.parse(String(result.stdout)) as { parameterMutations: unknown[] };
	assert.deepEqual(response.parameterMutations, [{ parameter: { name: 'parameter0', type: 'integer',
		value: otherHeld ? 8 : 7, keyframes: [{ frame: 12, value: 9 }] } }]);
});
