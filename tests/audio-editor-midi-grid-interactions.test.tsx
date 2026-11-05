/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NoteGrid } from '../vendor/audacity-design-system/components/src/PianoRoll/NoteGrid.tsx';
import type { MidiNote } from '../vendor/audacity-design-system/core/src/types/index.ts';
import { installReactTestDom, ReactTestElement, reactProps, type ReactTestDom } from './helpers/react-test-dom.ts';

interface GridFixture {
	readonly dom: ReactTestDom;
	readonly document: Document;
	readonly listeners: Map<string, Set<EventListener>>;
	readonly resized: { id: number; duration: number }[];
	readonly deleted: number[][];
	readonly updated: { id: number; changes: Partial<MidiNote> }[];
	readonly added: MidiNote[];
	readonly windowListeners: Map<string, Set<EventListener>>;
	readonly unmount: () => Promise<void>;
}

test('clicking a piano-roll note gives its grid keyboard focus for note shortcuts', async () => {
	await withGrid(async ({ dom, document }) => {
		await act(async () => {
			reactProps(dom.one('[data-note-id="1"]')).onMouseDown?.({ currentTarget: dom.one('[data-note-id="1"]'), button: 0, clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} });
		});
		assert.strictEqual(document.activeElement, dom.one('[tabindex="0"]'), 'note shortcuts must follow the clicked note');
	});
});

test('Caps Lock does not change the piano-roll Select All shortcut', async () => {
	await withGrid(async ({ dom, deleted }) => {
		const grid = dom.one('[tabindex="0"]');
		await act(async () => { reactProps(grid).onKeyDown?.({ key: 'A', ctrlKey: true, preventDefault() {}, stopPropagation() {} }); });
		await act(async () => { reactProps(grid).onKeyDown?.({ key: 'Delete', stopPropagation() {} }); });
		assert.deepEqual(deleted, [[1, 2]]);
	}, [
		{ id: 1, pitch: 60, velocity: 100, startTime: 0, duration: 0.5, selected: true },
		{ id: 2, pitch: 64, velocity: 100, startTime: 1, duration: 0.5, selected: false },
	]);
});

test('MIDI Select All releases distinct modified A shortcuts', async () => {
	await withGrid(async ({ dom }) => {
		for (const modifier of ['shiftKey', 'altKey']) {
			let prevented = false;
			await act(async () => { reactProps(dom.one('[tabindex="0"]')).onKeyDown?.({ key: 'A', ctrlKey: true, [modifier]: true,
				preventDefault() { prevented = true; }, stopPropagation() {} }); });
			assert.equal(prevented, false);
		}
	});
});

test('resizing a selected note keeps the complete resized selection for the next Delete', async () => {
	await withGrid(async ({ dom, listeners, resized, deleted }) => {
		const note = dom.one('[data-note-id="1"]');
		await act(async () => { reactProps(note).onMouseMove?.({ currentTarget: note, clientX: 47 }); });
		await act(async () => { reactProps(note).onMouseDown?.({ currentTarget: note, button: 0, clientX: 47, clientY: 10, preventDefault() {}, stopPropagation() {} }); });
		await act(async () => {
			for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 72, clientY: 10 } as MouseEvent);
		});
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({} as MouseEvent); });
		assert.deepEqual(resized, [{ id: 1, duration: 0.75 }, { id: 2, duration: 0.75 }]);
		await act(async () => { reactProps(dom.one('[tabindex="0"]')).onKeyDown?.({ key: 'Delete', stopPropagation() {} }); });
		assert.deepEqual(deleted, [[1, 2]]);
	});
});

test('moving a note group against time and pitch limits preserves its offsets and intervals', async () => {
	await withGrid(async ({ dom, listeners, updated }) => {
		await act(async () => { reactProps(dom.one('[data-note-id="2"]')).onMouseDown?.({ currentTarget: dom.one('[data-note-id="2"]'), button: 0, clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} }); });
		await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: -90, clientY: -1190 } as MouseEvent); });
		assert.deepEqual(updated, [{ id: 1, changes: { startTime: 0, pitch: 125 } }, { id: 2, changes: { startTime: 0.5, pitch: 127 } }]);
	}, [
		{ id: 1, pitch: 60, velocity: 100, startTime: 0.5, duration: 0.5, selected: true },
		{ id: 2, pitch: 62, velocity: 100, startTime: 1, duration: 0.5, selected: true },
	]);
});

test('a secondary-button note gesture does not move or resize authored notes', async () => {
	await withGrid(async ({ dom, listeners, updated, resized }) => {
		await act(async () => { reactProps(dom.one('[data-note-id="1"]')).onMouseDown?.({ currentTarget: dom.one('[data-note-id="1"]'), button: 2, clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} }); });
		await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 60, clientY: 10 } as MouseEvent); });
		assert.deepEqual(updated, []);
		assert.deepEqual(resized, []);
	});
});

test('drawing after a minimum-length resize reuses the positive audible length', async () => {
	await withGrid(async ({ dom, listeners, added, resized }) => {
		const note = dom.one('[data-note-id="1"]');
		await act(async () => { reactProps(note).onMouseMove?.({ currentTarget: note, clientX: 47 }); });
		await act(async () => { reactProps(note).onMouseDown?.({ currentTarget: note, button: 0, clientX: 47, clientY: 10, preventDefault() {}, stopPropagation() {} }); });
		await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 0, clientY: 10 } as MouseEvent); });
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({} as MouseEvent); });
		assert.equal(resized[0]?.duration, 1 / 64);
		const grid = dom.one('[tabindex="0"]');
		await act(async () => { reactProps(grid).onMouseDown?.({ button: 0, currentTarget: grid, clientX: 200, clientY: 32 }); });
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({} as MouseEvent); });
		assert.equal(added[0]?.duration, 1 / 64);
	});
});

test('leaving the window finishes a piano-roll drag before later pointer movement', async () => {
	await withGrid(async ({ dom, listeners, windowListeners, updated }) => {
		await act(async () => { reactProps(dom.one('[data-note-id="1"]')).onMouseDown?.({ currentTarget: dom.one('[data-note-id="1"]'), button: 0, clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} }); });
		await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 35, clientY: 10 } as MouseEvent); });
		assert.equal(updated.length, 2);
		await act(async () => { for (const listener of [...windowListeners.get('blur') ?? []]) listener({ type: 'blur' } as FocusEvent); });
		await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 60, clientY: 10 } as MouseEvent); });
		assert.equal(updated.length, 2, 'returning to the window must not resume the retired drag');
	});
});

test('closing a piano roll during note placement prevents a later mouseup from adding a note', async () => {
	await withGrid(async ({ dom, listeners, added, unmount }) => {
		const grid = dom.one('[tabindex="0"]');
		await act(async () => { reactProps(grid).onMouseDown?.({ button: 0, currentTarget: grid, clientX: 200, clientY: 32 }); });
		await unmount();
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({} as MouseEvent); });
		assert.deepEqual(added, []);
	});
});

test('releasing another mouse button keeps the primary note drag active until primary release', async () => {
	await withGrid(async ({ dom, listeners, updated }) => {
		await act(async () => { reactProps(dom.one('[data-note-id="1"]')).onMouseDown?.({ currentTarget: dom.one('[data-note-id="1"]'), button: 0, clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} }); });
		await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 35, clientY: 10 } as MouseEvent); });
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({ type: 'mouseup', button: 1, buttons: 1 } as MouseEvent); });
		await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 60, clientY: 10 } as MouseEvent); });
		assert.equal(updated.length, 4, 'middle release must not finish the held primary drag');
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({ type: 'mouseup', button: 0, buttons: 4 } as MouseEvent); });
		await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 85, clientY: 10 } as MouseEvent); });
		assert.equal(updated.length, 4, 'primary release finishes even while another button remains held');
	});
});

async function withGrid(action: (fixture: GridFixture) => Promise<void>, initialNotes?: readonly MidiNote[]): Promise<void> {
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
	const windowListeners = new Map<string, Set<EventListener>>();
	const ownerWindow = document.defaultView!;
	ownerWindow.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (typeof listener !== 'function') return;
		const entries = windowListeners.get(type) ?? new Set<EventListener>(); entries.add(listener); windowListeners.set(type, entries);
	};
	ownerWindow.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (typeof listener === 'function') windowListeners.get(type)?.delete(listener); };
	const resized: GridFixture['resized'] = [];
	const deleted: GridFixture['deleted'] = [];
	const updated: GridFixture['updated'] = [];
	const added: GridFixture['added'] = [];
	const noop = () => undefined;
	function Grid() {
		const [notes, setNotes] = useState<MidiNote[]>(() => initialNotes ? [...initialNotes] : [
			{ id: 1, pitch: 60, velocity: 100, startTime: 0, duration: 0.5, selected: true },
			{ id: 2, pitch: 64, velocity: 100, startTime: 1, duration: 0.5, selected: true },
		]);
		return <NoteGrid clip={{ id: 1, name: 'Notes', start: 0, duration: 2, trimStart: 0, notes }} width={800} height={200}
			bpm={120} beatsPerMeasure={4} pixelsPerSecond={100} scrollX={0} scrollY={1024} noteHeight={16}
			snap={{ subdivision: 4, triplet: false }} timeBasis="beats" onAddNote={note => { added.push(note); }} onUpdateNote={(id, changes) => { updated.push({ id, changes }); }} onMoveNotes={noop}
			onResizeNote={(id, duration) => { resized.push({ id, duration }); }} onDeleteNotes={ids => { deleted.push(ids); }}
			onSelectNote={(id, additive) => { setNotes(previous => previous.map(note => ({ ...note, selected: note.id === id || (additive === true && note.selected) }))); }}
			onSelectNotes={(ids, additive) => { setNotes(previous => previous.map(note => ({ ...note, selected: ids.includes(note.id) || (additive === true && note.selected) }))); }} onDeselectAll={noop} onScrollYChange={noop} />;
	}
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Grid />));
		for (const note of dom.container.querySelectorAll('[data-note-id]')) note.getBoundingClientRect = () => ({ left: 0, width: 50 });
		await action({ dom, document, listeners, resized, deleted, updated, added, windowListeners,
			unmount: async () => { await act(async () => root.unmount()); } });
	} finally {
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({} as MouseEvent); });
		await act(async () => root.unmount());
		if (canvasContext) Object.defineProperty(ReactTestElement.prototype, 'getContext', canvasContext);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
}
