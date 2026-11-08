/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NoteGrid } from '../vendor/audacity-design-system/components/src/PianoRoll/NoteGrid.tsx';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

test('a marquee intersecting the painted minimum-width note body selects it', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const context = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Map<string, Set<EventListener>>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (typeof listener !== 'function') return;
		const entries = listeners.get(type) ?? new Set<EventListener>(); entries.add(listener); listeners.set(type, entries);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (typeof listener === 'function') listeners.get(type)?.delete(listener);
	};
	const selected: number[][] = [];
	const noop = () => undefined;
	const root = createRoot(dom.container as unknown as Element);
	const content = <NoteGrid clip={{ id: 1, name: 'Short note', start: 0, duration: 1, trimStart: 0,
			notes: [{ id: 1, pitch: 60, velocity: 100, startTime: 0, duration: 0.001 }] }} width={800} height={200}
			bpm={120} beatsPerMeasure={4} pixelsPerSecond={100} scrollX={0} scrollY={1024} noteHeight={16}
			snap={{ subdivision: 4, triplet: false }} timeBasis="beats" onAddNote={noop} onDeleteNotes={noop} onUpdateNote={noop}
			onMoveNotes={noop} onResizeNote={noop} onSelectNote={noop} onSelectNotes={ids => { selected.push([...ids]); }}
			onDeselectAll={noop} onScrollYChange={noop} />;
	try {
		await act(async () => root.render(content));
		const grid = dom.one('[tabindex="0"]');
		await act(async () => { reactProps(grid).onMouseDown?.({ currentTarget: grid, button: 0, ctrlKey: true,
			clientX: 8, clientY: 43, preventDefault() {}, stopPropagation() {} }); });
		await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 2, clientY: 68 } as MouseEvent); });
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({ button: 0 } as MouseEvent); });
		assert.deepEqual(selected, [[1]]);
		await act(async () => root.render(React.cloneElement(content, { scrollX: 2 })));
		assert.ok(dom.find('[data-note-id="1"]'), 'the two remaining painted pixels are still visible after a pan');
	} finally {
		await act(async () => root.unmount());
		if (context) Object.defineProperty(ReactTestElement.prototype, 'getContext', context); else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		globals.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore();
	}
});
