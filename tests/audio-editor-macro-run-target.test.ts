/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { macroStartsWithCommand } from '../src/common/editor/ui/inspector/macro-run-target.ts';

test('a leading command supplies its own target, while effects still need audio', () => {
	assert.equal(macroStartsWithCommand([{ kind: 'command', command: 'NewMonoTrack' }]), true);
	assert.equal(macroStartsWithCommand([{ kind: 'command', command: 'Select' }, { type: 'fade-out' }]), true);
	assert.equal(macroStartsWithCommand([{ type: 'fade-out' }, { kind: 'command', command: 'Select' }]), false);
	assert.equal(macroStartsWithCommand([{ kind: 'command', enabled: false }, { type: 'fade-out' }]), false);
	assert.equal(macroStartsWithCommand([]), false);
});

test('target admission skips inert legacy values and disabled steps, but stops at the first enabled object', () => {
	const inert: readonly unknown[] = Object.freeze([undefined, null, false, 0, '', true, 3, 'legacy-step']);
	const command = Object.freeze({ kind: 'command', command: 'Select' });
	const disabled = Object.freeze({ kind: 'command', command: 'NewMonoTrack', enabled: false });
	const effect = Object.freeze({ type: 'fade-out' });

	assert.equal(macroStartsWithCommand(inert), false);
	assert.equal(macroStartsWithCommand([...inert, disabled, command]), true);
	assert.equal(macroStartsWithCommand([...inert, disabled, effect, command]), false);
	assert.equal(macroStartsWithCommand([...inert, {}, command]), false);
	assert.deepEqual(inert, [undefined, null, false, 0, '', true, 3, 'legacy-step']);
});
