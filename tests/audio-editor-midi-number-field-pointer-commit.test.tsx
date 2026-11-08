/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MidiNoteNumberField } from '../src/common/editor/ui/workspace/MidiNoteNumberField.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const scenario of ['outside', 'inside', 'secondary', 'invalid', 'cancelled'] as const) {
	test(`the ${scenario} pointer preserves the owning MIDI number draft before selection teardown`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const listeners = new Set<EventListener>();
		const document = dom.container.ownerDocument;
		Object.defineProperty(document, 'addEventListener', { configurable: true, value: (type: string, listener: EventListener) => {
			if (type === 'pointerdown') listeners.add(listener);
		} });
		Object.defineProperty(document, 'removeEventListener', { configurable: true, value: (type: string, listener: EventListener) => {
			if (type === 'pointerdown') listeners.delete(listener);
		} });
		const commits: { owner: string; value: number }[] = [];
		function Editor() {
			const [selected, select] = useState('first');
			return <><MidiNoteNumberField key={selected} value={selected === 'first' ? 60 : 64} min={0} max={127} step={1}
				disabled={false} onCommit={value => { commits.push({ owner: selected, value }); }} />
				<button type="button" onMouseDown={() => select('second')}>Other clip</button></>;
		}
		const root = createRoot(dom.container as unknown as Element);
		try {
			await act(async () => root.render(<Editor />));
			const input = dom.one('input'), other = dom.one('button');
			const blur = () => {
				if (document.activeElement !== input) return;
				// A removed native input's blur cannot reach React's delegated root.
				if (dom.container.querySelectorAll('input').includes(input)) reactProps(input).onBlur?.({});
				document.body.focus();
			};
			Object.defineProperty(input, 'blur', { configurable: true, value: blur });
			input.focus();
			await act(async () => { reactProps(input).onFocus?.({}); });
			await act(async () => { reactProps(input).onChange?.({ currentTarget: { value: scenario === 'invalid' ? '128' : '67' } }); });
			if (scenario === 'cancelled') await act(async () => { reactProps(input).onKeyDown?.({ key: 'Escape',
				currentTarget: { blur }, preventDefault() {}, stopPropagation() {} }); });
			await act(async () => {
				const target = scenario === 'inside' ? input : other;
				for (const listener of [...listeners]) listener({ button: scenario === 'secondary' ? 2 : 0, isPrimary: true, target } as unknown as PointerEvent);
				if (scenario !== 'inside' && scenario !== 'secondary') reactProps(other).onMouseDown?.({});
			});
			await act(async () => { if (scenario !== 'inside' && scenario !== 'secondary') blur(); });
			assert.deepEqual(commits, scenario === 'outside' ? [{ owner: 'first', value: 67 }] : []);
			if (scenario === 'inside' || scenario === 'secondary') assert.equal(document.activeElement, input);
		} finally {
			await act(async () => root.unmount());
			assert.equal(listeners.size, 0, 'field-owned document listeners retire with the field');
			globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore();
		}
	});
}
