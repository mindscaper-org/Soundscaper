/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PianoRollWorkspacePanel from '../src/common/editor/ui/workspace/PianoRollWorkspacePanel.tsx';
import { withMidiClipData, withMidiTrackData } from '../src/common/editor/midi-model.ts';
import type { EditorProject } from '../src/common/editor/types.ts';

const telemetry = { positionFrame: 0 };
const noop = () => undefined;
const controller = {
	subscribeTelemetry: () => noop,
	getTelemetrySnapshot: () => telemetry,
	actions: { midi: {
		addNote: noop, updateNote: noop, updateNotes: noop, deleteNotes: noop,
		resizeClip: noop, setInstrument: noop, previewNote: noop,
	} },
};

test('piano roll exposes a keyboard-accessible note editor and audition controls beside the design-system grid', () => {
	const clip = withMidiClipData({ kind: 'audio' as const, id: 'clip', sourceId: 'source', title: 'Notes',
		timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000 }, { version: 1, notes: [
		{ id: 'note', pitch: 60, velocity: 100, channel: 0, startFrame: 0, durationFrames: 12_000 },
	] });
	const track = withMidiTrackData({ type: 'audio' as const, id: 'track', name: 'Notes', height: 114, collapsed: false, locked: false, clipIds: ['clip'] }, { version: 1, instrument: 'triangle' });
	const project = { id: 'project', sampleRate: 48_000, clips: [clip], tracks: [track] } as unknown as EditorProject;
	const markup = renderToStaticMarkup(<PianoRollWorkspacePanel controller={controller}
		snapshot={{ project, selectedTrackId: 'track', selectedClipId: 'clip' }} copy={{}} blocked={false} run={operation => operation()} />);
	assert.match(markup, /role="group" aria-label="Note editor"/u);
	for (const label of ['Pitch (MIDI number)', 'Note start (seconds)', 'Note duration (seconds)', 'Velocity', 'MIDI channel']) {
		assert.ok(markup.includes(label), label);
	}
	assert.match(markup, /<option value="triangle" selected="">Triangle<\/option>/u);
	assert.match(markup, /Computer keyboard/u);
	assert.match(markup, /<option value="note">60/u);
	assert.match(markup, /<canvas/u);
});

test('piano roll explains how to choose a MIDI clip without adding controls to an audio selection', () => {
	const project = { id: 'project', sampleRate: 48_000, clips: [], tracks: [] } as unknown as EditorProject;
	const markup = renderToStaticMarkup(<PianoRollWorkspacePanel controller={controller}
		snapshot={{ project, selectedTrackId: null, selectedClipId: null }} copy={{}} blocked={false} run={operation => operation()} />);
	assert.match(markup, /Select a MIDI track or clip to edit\./u);
	assert.doesNotMatch(markup, /<button|<input|<select/u);
});
