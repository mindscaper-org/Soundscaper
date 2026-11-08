/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PianoRollWorkspacePanel from '../src/common/editor/ui/workspace/PianoRollWorkspacePanel.tsx';
import { withMidiClipData, withMidiTrackData } from '../src/common/editor/midi-model.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { secondsToSampleFrame } from '../src/common/editor/timeline-time.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

test('the duration step endpoint commits one positive source frame through the actual note editor', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const context = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	const root = createRoot(dom.container as unknown as Element);
	const source = createAudioSource({ id: 'source', storageKey: 'pcm', name: 'Notes', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
	const clip = withMidiClipData(createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 0, sourceStartFrame: 0,
		durationFrames: 48_000, sourceDurationFrames: 48_000 }),
		{ version: 1, notes: [{ id: 'note', startFrame: 0, durationFrames: 48, pitch: 60, velocity: 100, channel: 0 }] });
	const track = withMidiTrackData(createAudioTrack({ id: 'track', name: 'Notes', clipIds: [clip.id], locked: false }), { version: 1, instrument: 'triangle' });
	const admitted = createCurrentAudioEditorProject({ id: 'duration-endpoint', sources: [source], clips: [clip], tracks: [track] });
	const view = projectForRuntimeConsumers({ ...admitted, clips: [clip] });
	const zero = secondsToSampleFrame(0, admitted.sampleRate);
	const project = { ...admitted, sources: [source], clips: view.clips, tracks: [track], projectBin: { ...admitted.projectBin, clips: [] },
		selection: { ...admitted.selection, startFrame: zero, endFrame: zero, trackIds: [], clipIds: [], annotationIds: [], frequencyRange: null },
		sequences: admitted.sequences.map(sequence => ({ ...sequence, trackNodes: sequence.trackNodes.map(node => ({ ...node })) })),
		trackFolders: admitted.trackFolders.map(folder => ({ ...folder })), takeGroups: admitted.takeGroups.map(group => ({ ...group })) };
	const commits: unknown[] = [];
	const noop = () => undefined;
	const telemetry = { positionFrame: 0 };
	const controller = { subscribeTelemetry: () => noop, getTelemetrySnapshot: () => telemetry,
		actions: { midi: { addNote: noop, updateNote: noop, updateNotes: (_clipId: string, changes: unknown) => { commits.push(changes); },
			deleteNotes: noop, resizeClip: noop, setInstrument: noop, previewNote: noop } } };
	try {
		await act(async () => root.render(<PianoRollWorkspacePanel controller={controller} snapshot={{ project, selectedTrackId: track.id, selectedClipId: clip.id }}
			copy={{}} blocked={false} run={operation => operation()} />));
		const selected = dom.one('.kw-audio-editor__piano-roll-note-editor').querySelector('select');
		assert.ok(selected);
		await act(async () => { reactProps(selected).onChange?.({ currentTarget: { value: 'note' } }); });
		const duration = dom.container.querySelectorAll('input').find(input => String(reactProps(input).value) === '0.001');
		assert.ok(duration);
		await act(async () => { reactProps(duration).onFocus?.({}); reactProps(duration).onChange?.({ currentTarget: { value: '0' } }); });
		await act(async () => { reactProps(duration).onBlur?.({}); });
		assert.deepEqual(commits, [[{ id: 'note', changes: { durationFrames: 1 } }]]);
	} finally {
		await act(async () => root.unmount());
		if (context) Object.defineProperty(ReactTestElement.prototype, 'getContext', context); else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		globals.IS_REACT_ACT_ENVIRONMENT = prior;
		dom.restore();
	}
});
