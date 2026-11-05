/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NoteGrid } from '../vendor/audacity-design-system/components/src/PianoRoll/NoteGrid.tsx';
import type { MidiNote } from '../vendor/audacity-design-system/core/src/types/index.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

for (const triplet of [false, true]) test(`selected left-edge resize retains offsets and fixed right edges with triplet=${triplet}`, async () => {
	const notes = [
	{ id: 1, pitch: 60, velocity: 100, startTime: 0.125, duration: 0.5, selected: true },
	{ id: 2, pitch: 62, velocity: 100, startTime: 1, duration: 0.5, selected: true },
	];
	const updates = await resize(notes, -50, triplet);
	assert.deepEqual(updates.map(update => update.startTime), [0, 0.875]);
	assert.deepEqual(updates.map(update => update.startTime + update.duration), [0.625, 1.5]);
});

test('selected left-edge resize stops before the shortest note disappears', async () => {
	const notes = [
	{ id: 1, pitch: 60, velocity: 100, startTime: 0.125, duration: 0.0625, selected: true },
	{ id: 2, pitch: 62, velocity: 100, startTime: 1, duration: 0.5, selected: true },
	];
	const updates = await resize(notes, 25, false);
	assert.deepEqual(updates.map(update => update.startTime), [0.171875, 1.046875]);
	assert.deepEqual(updates.map(update => update.startTime + update.duration), [0.1875, 1.5]);
});

async function resize(notes: MidiNote[], dx: number, triplet: boolean): Promise<MidiNote[]> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const descriptor = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
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
	const updates = new Map<number, Partial<MidiNote>>();
	const noop = () => undefined;
	const root = createRoot(dom.container as unknown as Element);
	try {
	await act(async () => root.render(<NoteGrid clip={{ id: 1, name: 'Notes', start: 0, duration: 2, trimStart: 0, notes }}
	width={800} height={200} bpm={120} beatsPerMeasure={4} pixelsPerSecond={100} scrollX={0} scrollY={1024}
	noteHeight={16} snap={{ subdivision: 4, triplet }} timeBasis="beats" onAddNote={noop} onDeleteNotes={noop}
	onUpdateNote={(id, changes) => { updates.set(id, changes); }} onMoveNotes={noop} onResizeNote={noop}
	onSelectNote={noop} onSelectNotes={noop} onDeselectAll={noop} onScrollYChange={noop} />));
	const note = dom.one('[data-note-id="2"]'); note.getBoundingClientRect = () => ({ left: 100, width: 50 });
	await act(async () => { reactProps(note).onMouseDown?.({ currentTarget: note, button: 0, clientX: 101, clientY: 10,
	preventDefault() {}, stopPropagation() {} }); });
	await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 101 + dx, clientY: 10 } as MouseEvent); });
	return notes.map(note => ({ ...note, ...updates.get(note.id) }));
	} finally {
	await act(async () => root.unmount());
	if (descriptor) Object.defineProperty(ReactTestElement.prototype, 'getContext', descriptor);
	else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
	globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore();
	}
}
