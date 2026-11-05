/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PianoRollWorkspacePanel from '../src/common/editor/ui/workspace/PianoRollWorkspacePanel.tsx';
import { withMidiClipData, withMidiTrackData, type MidiNote } from '../src/common/editor/midi-model.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { secondsToSampleFrame } from '../src/common/editor/timeline-time.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

for (const mode of ['constant', 'musical', 'sampleLocked'] as const) for (const placement of ['origin', 'moved', 'reversed', 'stretched', 'cross rate', 'imported carrier'] as const) {
	test(`${placement} MIDI source grid follows ${mode} project clock`, async () => {
		const changing = mode !== 'constant';
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const prior = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const canvas = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
		Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
		const listeners = new Map<string, Set<EventListener>>();
		const originalAdd = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'addEventListener');
		Object.defineProperty(ReactTestElement.prototype, 'addEventListener', { configurable: true, value: (type: string, listener: EventListenerOrEventListenerObject | null) => {
			if (type === 'wheel' && typeof listener === 'function') {
				const callbacks = listeners.get(type) ?? new Set<EventListener>();
				callbacks.add(listener as EventListener); listeners.set(type, callbacks);
			}
		} });
		const rate = placement === 'cross rate' ? 16_000 : 48_000;
		const source = createAudioSource({ id: 'source', name: 'Native notes', storageKey: 'pcm', frameCount: rate * 12, sampleRate: rate, channelCount: 1 });
		const clip = withMidiClipData(createAudioClip({ id: 'clip', sourceId: source.id,
			timelineStartFrame: placement === 'moved' ? 480_000 : 0, sourceStartFrame: 0,
			durationFrames: placement === 'stretched' ? 1_152_000 : 576_000, sourceDurationFrames: rate * 12,
			reversed: placement === 'reversed' }), { version: 1, notes: [], ...(placement === 'imported carrier' ? {
				interchange: { tempos: [{ frame: 0, bpm: 90 }, { frame: rate * 3, bpm: 180 }], signatures: [], events: [] },
			} : {}) });
		const track = withMidiTrackData(createAudioTrack({ id: 'track', clipIds: [clip.id], locked: false }), { version: 1, instrument: 'sine' });
		const admitted = createCurrentAudioEditorProject({ id: 'musical-grid', sampleRate: 48_000, sources: [source], clips: [clip], tracks: [track],
			tempoMap: { mode: mode === 'sampleLocked' ? mode : 'musical', events: [
				{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 }, ...(mode === 'sampleLocked' ? { samplePosition: 0 } : {}) },
				...(changing ? [{ beat: { num: 8, den: 1 }, bpm: { num: 60, den: 1 }, ...(mode === 'sampleLocked' ? { samplePosition: 192_000 } : {}) }] : [])] } });
		const view = projectForRuntimeConsumers({ ...admitted, clips: [clip] });
		const zero = secondsToSampleFrame(0, admitted.sampleRate);
		const project = { ...admitted, sources: [source], clips: view.clips, tracks: [track], projectBin: { ...admitted.projectBin, clips: [] },
			selection: { ...admitted.selection, startFrame: zero, endFrame: zero, trackIds: [], clipIds: [], annotationIds: [], frequencyRange: null },
			sequences: admitted.sequences.map(sequence => ({ ...sequence, trackNodes: sequence.trackNodes.map(node => ({ ...node })) })),
			trackFolders: admitted.trackFolders.map(folder => ({ ...folder })), takeGroups: admitted.takeGroups.map(group => ({ ...group })) };
		const added: MidiNote[] = [];
		const noop = () => undefined;
		const telemetry = { positionFrame: 0 };
		const controller = { subscribeTelemetry: () => noop, getTelemetrySnapshot: () => telemetry, actions: { midi: {
			addNote: (_id: string, note: MidiNote) => { added.push(note); }, updateNote: noop, updateNotes: noop, deleteNotes: noop,
			resizeClip: noop, setInstrument: noop, previewNote: noop,
		} } };
		const root = createRoot(dom.container as unknown as Element);
		try {
			await act(async () => root.render(<PianoRollWorkspacePanel controller={controller} snapshot={{ project, selectedTrackId: track.id, selectedClipId: clip.id }}
				copy={{}} blocked={false} run={operation => operation()} />));
			await act(async () => {
				for (const listener of listeners.get('wheel') ?? []) listener({ deltaX: 0, deltaY: 400, deltaMode: 0, shiftKey: true,
					preventDefault() {}, clientX: 0 } as unknown as WheelEvent);
			});
			const button = dom.container.querySelectorAll('button').find(node => node.textContent === 'Add note'); assert.ok(button);
			await act(async () => { reactProps(button).onClick({}); });
			assert.equal(added.length, 1);
			assert.equal(added[0]!.startFrame, rate * 4, 'placement and playback transforms do not change source-time editing');
			assert.equal(added[0]!.durationFrames, rate * (changing ? .25 : .125), '1/16 follows the authored source-time quarter note');
		} finally {
			await act(async () => root.unmount());
			if (originalAdd) Object.defineProperty(ReactTestElement.prototype, 'addEventListener', originalAdd); else Reflect.deleteProperty(ReactTestElement.prototype, 'addEventListener');
			if (canvas) Object.defineProperty(ReactTestElement.prototype, 'getContext', canvas); else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
			globals.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore();
		}
	});
}
