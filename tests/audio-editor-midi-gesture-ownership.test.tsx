/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PianoRollWorkspacePanel from '../src/common/editor/ui/workspace/PianoRollWorkspacePanel.tsx';
import { withMidiClipData, withMidiTrackData, type MidiNote } from '../src/common/editor/midi-model.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { secondsToSampleFrame } from '../src/common/editor/timeline-time.ts';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

test('an earlier MIDI publication cannot erase a newer held note preview', async () => {
	const panel = await mountPanel();
	try {
		await panel.begin(10);
		await panel.move(60);
		await panel.release();
		assert.equal(panel.left(), '50px');
		assert.equal(panel.updates.length, 1);
		await panel.begin(60);
		await panel.move(110);
		assert.equal(panel.left(), '100px');
		await panel.completeFirst();
		assert.equal(panel.left(), '100px', 'the newer pending drag still owns its painted position');
		await panel.release();
		assert.equal(panel.updates.length, 2);
		assert.equal(panel.updates[1]?.[0]?.changes.startFrame, 48_000);
	} finally { await panel.dispose(); }
});

for (const moveFirst of [false, true]) test(`undoing a held MIDI note retires ${moveFirst ? 'its preview' : 'its unstarted movement'}`, async () => {
	const panel = await mountPanel();
	try {
		await panel.begin(10);
		if (moveFirst) await panel.move(60);
		await panel.removeNote();
		await panel.move(110);
		await panel.release();
		assert.equal(panel.updates.length, 0, 'a note removed by Undo cannot receive a stale drag edit');
	} finally { await panel.dispose(); }
});

function noteProject(notes: readonly MidiNote[]) {
	const source = createAudioSource({ id: 'source', storageKey: 'pcm', name: 'Notes', frameCount: 96_000, sampleRate: 48_000, channelCount: 1 });
	const clip = withMidiClipData(createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 96_000, sourceDurationFrames: 96_000 }), { version: 1, notes });
	const track = withMidiTrackData(createAudioTrack({ id: 'track', clipIds: [clip.id], locked: false }), { version: 1, instrument: 'triangle' });
	const admitted = createCurrentAudioEditorProject({ id: 'note-gesture-ownership', sources: [source], clips: [clip], tracks: [track] });
	const view = projectForRuntimeConsumers({ ...admitted, clips: [clip] });
	const zero = secondsToSampleFrame(0, admitted.sampleRate);
	return { ...admitted, sources: [source], clips: view.clips, tracks: [track], projectBin: { ...admitted.projectBin, clips: [] },
		selection: { ...admitted.selection, startFrame: zero, endFrame: zero, trackIds: [], clipIds: [], annotationIds: [], frequencyRange: null },
		sequences: admitted.sequences.map(sequence => ({ ...sequence, trackNodes: sequence.trackNodes.map(node => ({ ...node })) })),
		trackFolders: admitted.trackFolders.map(folder => ({ ...folder })), takeGroups: admitted.takeGroups.map(group => ({ ...group })) };
}

async function mountPanel() {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const context = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	const bounds = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getBoundingClientRect');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', { configurable: true,
		value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 600, width: 1200, height: 600 }) });
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Map<string, Set<EventListener>>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (typeof listener !== 'function') return;
		const entries = listeners.get(type) ?? new Set<EventListener>(); entries.add(listener); listeners.set(type, entries);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (typeof listener === 'function') listeners.get(type)?.delete(listener); };
	const root = createRoot(dom.container as unknown as Element);
	type Update = Readonly<{ id: string; changes: Partial<MidiNote> }>;
	const updates: (readonly Update[])[] = [];
	const first = deferred<void>();
	let notes: readonly MidiNote[] = [{ id: 'note', pitch: 60, velocity: 100, channel: 0, startFrame: 0, durationFrames: 24_000 }];
	let publish: (next: readonly MidiNote[]) => void = () => undefined;
	const noop = () => undefined, telemetry = { positionFrame: 0 };
	const controller = { subscribeTelemetry: () => noop, getTelemetrySnapshot: () => telemetry,
		actions: { midi: { addNote: noop, updateNote: noop, deleteNotes: noop, resizeClip: noop, setInstrument: noop, previewNote: noop,
			updateNotes: async (_clipId: string, edits: readonly Update[]) => {
				updates.push(edits);
				if (updates.length === 1) await first.promise;
				notes = notes.map(note => ({ ...note, ...edits.find(edit => edit.id === note.id)?.changes }));
				publish(notes);
			} } } };
	function Fixture() {
		const [project, setProject] = useState(() => noteProject(notes));
		publish = next => setProject(noteProject(next));
		return <PianoRollWorkspacePanel controller={controller} snapshot={{ project, selectedTrackId: 'track', selectedClipId: 'clip' }}
			copy={{}} blocked={false} run={operation => operation()} />;
	}
	const dispatch = async (type: string, event: object) => { await act(async () => {
		for (const listener of [...listeners.get(type) ?? []]) listener(event as Event);
	}); };
	await act(async () => root.render(<Fixture />));
	return {
		updates,
		left: () => String(Reflect.get(dom.one('[data-note-id="1"]').style, 'left')),
		begin: async (x: number) => { await act(async () => {
			const target = dom.one('[data-note-id="1"]');
			target.getBoundingClientRect = () => ({ left: Number.parseFloat(String(Reflect.get(target.style, 'left'))), width: 50 });
			reactProps(dom.one('.kw-audio-editor__piano-roll-notes')).onMouseDownCapture?.({ target });
			reactProps(target).onMouseDown?.({ target, currentTarget: target, button: 0, clientX: x, clientY: 10, preventDefault() {}, stopPropagation() {} });
		}); },
		move: (x: number) => dispatch('mousemove', { clientX: x, clientY: 10, buttons: 1 }),
		release: () => dispatch('mouseup', { button: 0 }),
		completeFirst: async () => { await act(async () => { first.resolve(); await first.promise; }); },
		removeNote: async () => { await act(async () => { notes = []; publish(notes); }); },
		dispose: async () => {
			await act(async () => { first.resolve(); await first.promise; });
			await act(async () => root.unmount());
			if (context) Object.defineProperty(ReactTestElement.prototype, 'getContext', context); else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
			if (bounds) Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', bounds); else Reflect.deleteProperty(ReactTestElement.prototype, 'getBoundingClientRect');
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
		},
	};
}
