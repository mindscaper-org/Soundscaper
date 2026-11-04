/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MidiNoteNumberField } from '../src/common/editor/ui/workspace/MidiNoteNumberField.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('MIDI note numbers keep partial typing local and commit a complete valid value once', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const commits: number[] = [];
	try {
		await act(async () => root.render(<MidiNoteNumberField value={60} min={0} max={127} step={1} disabled={false} onCommit={value => { commits.push(value); }} />));
		const input = dom.one('input');
		await act(async () => { reactProps(input).onFocus?.({}); });
		for (const value of ['', '6', '67']) await act(async () => { reactProps(input).onChange?.({ currentTarget: { value } }); });
		assert.equal(input.value, '67');
		assert.deepEqual(commits, []);
		await act(async () => { reactProps(input).onBlur?.({}); });
		assert.deepEqual(commits, [67]);
		await act(async () => { reactProps(input).onFocus?.({}); reactProps(input).onChange?.({ currentTarget: { value: '128' } }); });
		await act(async () => { reactProps(input).onBlur?.({}); });
		assert.equal(input.value, '60');
		assert.deepEqual(commits, [67]);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
});
