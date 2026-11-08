/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NoteGrid } from '../vendor/audacity-design-system/components/src/PianoRoll/NoteGrid.tsx';
import { NoteGridCanvas } from '../vendor/audacity-design-system/components/src/PianoRoll/NoteGridCanvas.tsx';
import { PianoRollRuler } from '../vendor/audacity-design-system/components/src/PianoRoll/PianoRollRuler.tsx';
import { PianoRollClipStrip } from '../vendor/audacity-design-system/components/src/PianoRoll/PianoRollClipStrip.tsx';
import type { MidiNote } from '../vendor/audacity-design-system/core/src/types/index.ts';
import { createMidiPanelMusicalClock } from '../src/common/editor/ui/workspace/midi-panel-musical-clock.ts';
import { pianoRollGridMath } from '../vendor/audacity-design-system/components/src/PianoRoll/musical-clock.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

const clock = createMidiPanelMusicalClock({ sampleRate: 48_000, tempoMap: { mode: 'musical', events: [
	{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }, { beat: { num: 8, den: 1 }, bpm: { num: 60, den: 1 } },
] } });

test('an anchored duration keeps a native source frame at half a project frame', () => {
	const clock = createMidiPanelMusicalClock({ sampleRate: 8_000, tempoMap: { mode: 'musical', events: [
		{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }, { beat: { num: 8, den: 1 }, bpm: { num: 60, den: 1 } },
	] } });
	const sourceRate = 16_000;
	const duration = pianoRollGridMath(120, { subdivision: 4, triplet: false }, clock).durationAt(1 / sourceRate);
	assert.equal(Math.round(duration * sourceRate), 2000, 'only the final native source-frame boundary is rounded');
});

for (const gesture of ['draw', 'triplet', 'move', 'right', 'left'] as const) test(`authored musical source clock controls note ${gesture}`, async () => {
	const drawingNote = gesture === 'draw' || gesture === 'triplet';
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const canvas = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Map<string, Set<EventListener>>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (typeof listener !== 'function') return;
		const entries = listeners.get(type) ?? new Set<EventListener>(); entries.add(listener); listeners.set(type, entries);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (typeof listener === 'function') listeners.get(type)?.delete(listener); };
	const notes = [{ id: 1, pitch: 60, velocity: 100, startTime: 4.25, duration: gesture === 'left' ? .75 : .25, selected: true },
		{ id: 2, pitch: 62, velocity: 100, startTime: 5.25, duration: 1.25, selected: true }];
	const updated = new Map<number, Partial<MidiNote>>(), added: MidiNote[] = [];
	const noop = () => undefined;
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<NoteGrid musicalClock={clock} clip={{ id: 1, name: 'Native notes', start: 0, duration: 12, trimStart: 0,
			notes: drawingNote ? [] : notes }} bpm={120} beatsPerMeasure={4} width={1000} height={200} scrollX={0} scrollY={1024}
			pixelsPerSecond={100} noteHeight={16} snap={{ subdivision: 4, triplet: gesture === 'triplet' }} timeBasis="beats" onAddNote={note => { added.push(note); }}
			onUpdateNote={(id, changes) => { updated.set(id, { ...updated.get(id), ...changes }); }} onResizeNote={(id, duration) => { updated.set(id, { duration }); }}
			onDeleteNotes={noop} onMoveNotes={noop} onSelectNote={noop} onSelectNotes={noop} onDeselectAll={noop} onScrollYChange={noop} />));
		const grid = dom.one('[tabindex="0"]');
		grid.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 200 });
		if (drawingNote) {
			await act(async () => { reactProps(grid).onMouseDown({ button: 0, clientX: 424, clientY: 56, currentTarget: grid }); });
		} else {
			const note = dom.one('[data-note-id="1"]');
			const width = notes[0]!.duration * 100;
			note.getBoundingClientRect = () => ({ left: 425, top: 48, width, height: 16 });
			const x = gesture === 'left' ? 426 : gesture === 'right' ? 425 + width - 1 : 435;
			await act(async () => { reactProps(note).onMouseDown({ button: 0, clientX: x, clientY: 56, currentTarget: note, preventDefault() {}, stopPropagation() {} }); });
			await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: x + 38, clientY: 56, buttons: 1 } as MouseEvent); });
		}
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({ button: 0 } as MouseEvent); });
		if (drawingNote) {
			if (gesture === 'triplet') {
				assert.ok(Math.abs(added[0]!.startTime - (4 + 1 / 6)) < 1 / 48_000);
				assert.ok(Math.abs(added[0]!.duration - 1 / 6) < 1 / 48_000);
			} else { assert.equal(added[0]?.startTime, 4.25); assert.equal(added[0]?.duration, .25); }
		} else if (gesture === 'move') {
			assert.deepEqual([...updated.values()].map(note => note.startTime), [4.75, 5.75], 'moving retains source-time offsets across notes');
		} else if (gesture === 'right') {
			assert.deepEqual([...updated.values()].map(note => note.duration), [.75, 1.75], 'right resizing shares its duration delta');
		} else {
			const result = notes.map(note => ({ ...note, ...updated.get(note.id) }));
			assert.deepEqual(result.map(note => note.startTime), [4.75, 5.75]);
			assert.deepEqual(result.map(note => note.startTime + note.duration), [5, 6.5], 'left resizing retains both source right edges');
		}
	} finally {
		await act(async () => root.unmount());
		if (canvas) Object.defineProperty(ReactTestElement.prototype, 'getContext', canvas); else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		globals.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore();
	}
});

for (const edge of ['left', 'right'] as const) test(`source-local clip ${edge} boundary snaps through the authored clock`, async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Map<string, Set<EventListener>>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (typeof listener !== 'function') return;
		const entries = listeners.get(type) ?? new Set<EventListener>(); entries.add(listener); listeners.set(type, entries);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (typeof listener === 'function') listeners.get(type)?.delete(listener); };
	const root = createRoot(dom.container as unknown as Element);
	const resized: { start: number; duration: number; trim: number }[] = [];
	try {
		await act(async () => root.render(<PianoRollClipStrip musicalClock={clock} clips={[{ id: 1, name: 'Native', start: 10, duration: 2, trimStart: 4, notes: [] }]}
			activeClipId={1} width={1000} scrollX={0} pixelsPerSecond={100} bpm={120} snap={{ subdivision: 4, triplet: false }}
			onResizeClip={(_edge, start, duration, trim) => { resized.push({ start, duration, trim }); }} />));
		const handle = dom.container.querySelectorAll('div').find(node => Reflect.get(node.style, 'cursor') === 'ew-resize' && Reflect.get(node.style, edge) === '0');
		assert.ok(handle);
		const x = edge === 'left' ? 400 : 600;
		await act(async () => { reactProps(handle).onMouseDown({ button: 0, clientX: x, preventDefault() {}, stopPropagation() {} }); });
		await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: x + 38, buttons: 1 } as MouseEvent); });
		assert.deepEqual(resized.at(-1), edge === 'left' ? { start: 10.5, duration: 1.5, trim: 4.5 } : { start: 10, duration: 2.5, trim: 4 });
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore();
	}
});

for (const changing of [false, true]) test(`ruler and grid share ${changing ? 'later three-quarter bars' : 'native eighth-note pulses'}`, async () => {
	const musicalClock = createMidiPanelMusicalClock({ sampleRate: 48_000, signatureMap: { events: [
		{ bar: 0, numerator: 4, denominator: changing ? 4 : 8 }, ...(changing ? [{ bar: 2, numerator: 3, denominator: 4 }] : []),
	] } });
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const canvas = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	const strokes: { x: number; style: string }[] = [], labels: { x: number; text: string }[] = [];
	let x = 0;
	const drawing = { strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', scale() {}, clearRect() {}, fillRect() {}, beginPath() {},
		moveTo(next: number) { x = next; }, lineTo() {}, stroke() { strokes.push({ x, style: this.strokeStyle }); },
		fillText(text: string, next: number) { labels.push({ x: next, text }); } };
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => drawing });
	const root = createRoot(dom.container as unknown as Element);
	try {
		const pixelsPerSecond = changing ? 100 : 200;
		await act(async () => root.render(<><PianoRollRuler musicalClock={musicalClock} width={1000} scrollX={0} pixelsPerSecond={pixelsPerSecond} bpm={120} beatsPerMeasure={changing ? 4 : 2}
			snap={{ subdivision: 4, triplet: false }} timeBasis="beats" />
			<NoteGridCanvas musicalClock={musicalClock} width={1000} height={200} scrollX={0} scrollY={1024} noteHeight={16} pixelsPerSecond={pixelsPerSecond} bpm={120}
				beatsPerMeasure={changing ? 4 : 2} snap={{ subdivision: 4, triplet: false }} timeBasis="beats" /></>));
		assert.ok(labels.some(label => label.text === (changing ? '4' : '1.3') && label.x === (changing ? 554 : 104)),
			changing ? 'the fourth bar begins at5.5source seconds' : 'half a4/8bar is native beat1.3');
		const barStyle = strokes.filter(stroke => stroke.x === 400).at(-1)?.style;
		assert.ok(barStyle);
		assert.equal(strokes.filter(stroke => stroke.x === (changing ? 550 : 200)).at(-1)?.style, barStyle, 'the grid and ruler agree on measure boundaries');
	} finally {
		await act(async () => root.unmount());
		if (canvas) Object.defineProperty(ReactTestElement.prototype, 'getContext', canvas); else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		globals.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore();
	}
});
