/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NoteGrid } from '../vendor/audacity-design-system/components/src/PianoRoll/NoteGrid.tsx';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

test('piano-roll wheel line and page units address the complete lane and viewport', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const descriptors = new Map(['addEventListener', 'removeEventListener', 'getContext']
		.map(key => [key, Object.getOwnPropertyDescriptor(ReactTestElement.prototype, key)]));
	let wheel: EventListener | null = null;
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	Object.defineProperty(ReactTestElement.prototype, 'addEventListener', { configurable: true,
		value(this: ReactTestElement, kind: string, listener: EventListener) {
			if (kind === 'wheel' && this.getAttribute('tabindex') === '0') wheel = listener;
		} });
	Object.defineProperty(ReactTestElement.prototype, 'removeEventListener', { configurable: true,
		value(_kind: string, listener: EventListener) { if (wheel === listener) wheel = null; } });
	const root = createRoot(dom.container as unknown as Element);
	const vertical: number[] = [], horizontal: number[] = [];
	const noop = () => undefined;
	try {
		await act(async () => root.render(<NoteGrid clip={{ id: 1, name: 'Notes', start: 0, duration: 2, trimStart: 0, notes: [] }}
			width={800} height={200} bpm={120} beatsPerMeasure={4} pixelsPerSecond={100} scrollX={100} scrollY={1024} noteHeight={16}
			snap={{ subdivision: 4, triplet: false }} timeBasis="beats" onAddNote={noop} onUpdateNote={noop} onMoveNotes={noop}
			onResizeNote={noop} onDeleteNotes={noop} onSelectNote={noop} onSelectNotes={noop} onDeselectAll={noop}
			onScrollYChange={value => { vertical.push(value); }} onScrollXChange={value => { horizontal.push(value); }} />));
		assert.ok(wheel);
		for (const data of [
			{ deltaMode: 1, deltaX: 0, deltaY: 3 },
			{ deltaMode: 2, deltaX: 0, deltaY: 1 },
			{ deltaMode: 2, deltaX: 0, deltaY: 1, shiftKey: true },
			{ deltaMode: 1, deltaX: -2, deltaY: 0 },
			{ deltaMode: 0, deltaX: 0, deltaY: 10 },
		]) {
			const event = Object.assign(new Event('wheel', { cancelable: true }), data);
			await act(async () => { wheel?.(event); });
			assert.equal(event.defaultPrevented, true);
		}
		assert.deepEqual(vertical, [1072, 1224, 1034]);
		assert.deepEqual(horizontal, [900, 68]);
	} finally {
		await act(async () => root.unmount());
		for (const [key, descriptor] of descriptors) {
			if (descriptor) Object.defineProperty(ReactTestElement.prototype, key, descriptor);
			else Reflect.deleteProperty(ReactTestElement.prototype, key);
		}
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
