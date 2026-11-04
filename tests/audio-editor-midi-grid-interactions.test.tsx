/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NoteGrid } from '../vendor/audacity-design-system/components/src/PianoRoll/NoteGrid.tsx';
import { installReactTestDom, ReactTestElement, reactProps, type ReactTestDom } from './helpers/react-test-dom.ts';

interface GridFixture {
	readonly dom: ReactTestDom;
	readonly document: Document;
	readonly listeners: Map<string, Set<EventListener>>;
	readonly resized: { id: number; duration: number }[];
	readonly deleted: number[][];
}

test('clicking a piano-roll note gives its grid keyboard focus for note shortcuts', async () => {
	await withGrid(async ({ dom, document }) => {
		await act(async () => {
			reactProps(dom.one('[data-note-id="1"]')).onMouseDown?.({ clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} });
		});
		assert.strictEqual(document.activeElement, dom.one('[tabindex="0"]'), 'note shortcuts must follow the clicked note');
	});
});

test('resizing a selected note keeps the complete resized selection for the next Delete', async () => {
	await withGrid(async ({ dom, listeners, resized, deleted }) => {
		const note = dom.one('[data-note-id="1"]');
		await act(async () => { reactProps(note).onMouseMove?.({ currentTarget: note, clientX: 10 }); });
		await act(async () => { reactProps(note).onMouseDown?.({ clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} }); });
		await act(async () => {
			for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 35, clientY: 10 } as MouseEvent);
		});
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({} as MouseEvent); });
		assert.deepEqual(resized, [{ id: 1, duration: 0.75 }, { id: 2, duration: 0.75 }]);
		await act(async () => { reactProps(dom.one('[tabindex="0"]')).onKeyDown?.({ key: 'Delete', stopPropagation() {} }); });
		assert.deepEqual(deleted, [[1, 2]]);
	});
});

async function withGrid(action: (fixture: GridFixture) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const canvasContext = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	const listeners = new Map<string, Set<EventListener>>();
	const document = dom.container.ownerDocument as unknown as Document;
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (typeof listener !== 'function') return;
		const entries = listeners.get(type) ?? new Set<EventListener>();
		entries.add(listener); listeners.set(type, entries);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (typeof listener === 'function') listeners.get(type)?.delete(listener); };
	const resized: GridFixture['resized'] = [];
	const deleted: GridFixture['deleted'] = [];
	const noop = () => undefined;
	function Grid() {
		const [notes, setNotes] = useState([
			{ id: 1, pitch: 60, velocity: 100, startTime: 0, duration: 0.5, selected: true },
			{ id: 2, pitch: 64, velocity: 100, startTime: 1, duration: 0.5, selected: true },
		]);
		return <NoteGrid clip={{ id: 1, name: 'Notes', start: 0, duration: 2, trimStart: 0, notes }} width={800} height={200}
			bpm={120} beatsPerMeasure={4} pixelsPerSecond={100} scrollX={0} scrollY={1024} noteHeight={16}
			snap={{ subdivision: 4, triplet: false }} timeBasis="beats" onAddNote={noop} onUpdateNote={noop} onMoveNotes={noop}
			onResizeNote={(id, duration) => { resized.push({ id, duration }); }} onDeleteNotes={ids => { deleted.push(ids); }}
			onSelectNote={(id, additive) => { setNotes(previous => previous.map(note => ({ ...note, selected: note.id === id || (additive === true && note.selected) }))); }}
			onSelectNotes={noop} onDeselectAll={noop} onScrollYChange={noop} />;
	}
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Grid />));
		await action({ dom, document, listeners, resized, deleted });
	} finally {
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({} as MouseEvent); });
		await act(async () => root.unmount());
		if (canvasContext) Object.defineProperty(ReactTestElement.prototype, 'getContext', canvasContext);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
}
