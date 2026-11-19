/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PianoRollWorkspacePanel from '../src/common/editor/ui/workspace/PianoRollWorkspacePanel.tsx';
import { MIDI_EXTENSION_KEY, readMidiClip, withMidiClipData, withMidiTrackData } from '../src/common/editor/midi-model.ts';
import type { EditorProject } from '../src/common/editor/types.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

test('piano-roll view and drag updates retain unchanged note options while edited labels stay live', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const canvasContext = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	const getComputedStyle = window.getComputedStyle;
	let pianoKeyStyleReads = 0;
	window.getComputedStyle = element => {
		if (element.hasAttribute('data-piano-key')) pianoKeyStyleReads++;
		return getComputedStyle(element);
	};
	const listeners = new Map<string, Set<EventListener>>();
	const document = dom.container.ownerDocument as unknown as Document;
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (typeof listener !== 'function') return;
		const entries = listeners.get(type) ?? new Set<EventListener>();
		entries.add(listener); listeners.set(type, entries);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (typeof listener === 'function') listeners.get(type)?.delete(listener); };
	const root = createRoot(dom.container as unknown as Element);
	const noop = () => undefined;
	const telemetry = { positionFrame: 0 };
	const controller = {
		subscribeTelemetry: () => noop, getTelemetrySnapshot: () => telemetry,
		actions: { midi: { addNote: noop, updateNote: noop, updateNotes: noop, deleteNotes: noop,
			resizeClip: noop, setInstrument: noop, previewNote: noop } },
	};
	const notes = Array.from({ length: 1_024 }, (_, index) => ({ id: `note-${index}`, pitch: 60,
		velocity: 96, channel: 0, startFrame: index * 24_000, durationFrames: 12_000 }));
	const clip = withMidiClipData({ kind: 'audio' as const, id: 'clip', sourceId: 'source', title: 'Notes',
		timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 120_000_000, sourceDurationFrames: 120_000_000 }, { version: 1, notes });
	let noteReads = 0;
	const observedClip = { ...clip, opaqueExtensions: { [MIDI_EXTENSION_KEY]: {
		...readMidiClip(clip), get notes() { noteReads++; return notes; },
	} } };
	const track = withMidiTrackData({ type: 'audio' as const, id: 'track', name: 'Notes', height: 114,
		collapsed: false, locked: false, clipIds: ['clip'] }, { version: 1, instrument: 'sine' });
	const project = { id: 'project', sampleRate: 48_000, clips: [observedClip], tracks: [track] } as unknown as EditorProject;
	const render = (document: EditorProject) => root.render(<PianoRollWorkspacePanel controller={controller}
		snapshot={{ project: document, selectedTrackId: 'track', selectedClipId: 'clip' }} copy={{}} blocked={false} run={operation => operation()} />);
	try {
		await act(async () => { render(project); });
		assert.equal(noteReads, 1, 'one selection admission supplies the editor notes');
		await act(async () => { render({ ...project, revision: project.revision + 1 }); });
		assert.equal(noteReads, 1, 'a new project view with unchanged clip membership retains selection admission');
		dom.one('[data-note-id="1"]').getBoundingClientRect = () => ({ left: 0, width: 50 });
		const picker = dom.container.querySelectorAll('select')[2]!;
		const option = dom.one('[value="note-800"]');
		const initialProps = reactProps(option);
		const triplets = dom.container.querySelectorAll('input').find(input => input.type === 'checkbox');
		assert.ok(triplets);
		await act(async () => { reactProps(triplets).onChange?.({ currentTarget: { checked: true } }); });
		assert.ok(initialProps === reactProps(option), 'changing the note grid should reuse unchanged note-option work');
		assert.equal(picker.options.length, notes.length + 1);
		await act(async () => {
			reactProps(dom.one('.kw-audio-editor__piano-roll-notes')).onMouseDownCapture?.({ button: 0 });
			reactProps(dom.one('[data-note-id="1"]')).onMouseDown?.({ currentTarget: dom.one('[data-note-id="1"]'), button: 0, clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} });
		});
		assert.ok(pianoKeyStyleReads > 0, 'piano-key navigation was initialized');
		const beforeDrag = pianoKeyStyleReads;
		await act(async () => {
			for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 60, clientY: 10 } as MouseEvent);
		});
		assert.equal(pianoKeyStyleReads, beforeDrag, 'a draft note move must not redo piano-key focus discovery');
		assert.equal(dom.one('[value="note-0"]').textContent, '60 · 0.500s');
		assert.ok(initialProps === reactProps(option), 'dragging another note should reuse untouched note-option work');
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({} as MouseEvent); });
		const edited = withMidiClipData(clip, { version: 1, notes: notes.map(note => note.id === 'note-800'
			? { ...note, pitch: 72, startFrame: 19_224_000 } : note) });
		await act(async () => { render({ ...project, clips: [edited] }); });
		assert.equal(option.textContent, '72 · 400.500s');
	} finally {
		await act(async () => root.unmount());
		if (canvasContext) Object.defineProperty(ReactTestElement.prototype, 'getContext', canvasContext);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
