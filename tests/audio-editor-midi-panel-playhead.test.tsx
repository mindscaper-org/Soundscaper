/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PianoRollWorkspacePanel from '../src/common/editor/ui/workspace/PianoRollWorkspacePanel.tsx';
import { withMidiClipData, withMidiTrackData } from '../src/common/editor/midi-model.ts';
import type { EditorAudioClip, EditorProject } from '../src/common/editor/types.ts';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

test('piano-roll cursor follows the audible source through speed, reverse, loop and warp edits', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const descriptors = new Map(['getContext', 'getBoundingClientRect'].map(key => [key, Object.getOwnPropertyDescriptor(ReactTestElement.prototype, key)]));
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', { configurable: true, value(this: ReactTestElement) {
		const height = this.getAttribute('class')?.includes('piano-roll-controls') ? 100 : 600;
		return { x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: height, width: 1200, height };
	} });
	const root = createRoot(dom.container as unknown as Element);
	const noop = () => undefined;
	let telemetry = { positionFrame: 0 };
	const controller = { subscribeTelemetry: () => noop, getTelemetrySnapshot: () => telemetry,
		actions: { midi: { addNote: noop, updateNote: noop, updateNotes: noop, deleteNotes: noop, resizeClip: noop, setInstrument: noop, previewNote: noop } } };
	const base = withMidiClipData({ kind: 'audio' as const, id: 'clip', sourceId: 'source', title: 'Notes', timelineStartFrame: 48_000,
		sourceStartFrame: 24_000, sourceDurationFrames: 48_000, durationFrames: 96_000 }, { version: 1, notes: [
		{ id: 'note', pitch: 60, velocity: 100, channel: 0, startFrame: 48_000, durationFrames: 12_000 },
	] });
	const track = withMidiTrackData({ type: 'audio' as const, id: 'track', name: 'Notes', clipIds: ['clip'], height: 114, collapsed: false, locked: false }, { version: 1, instrument: 'sine' });
	const cases: readonly { name: string; clip: EditorAudioClip; position: number; x: number | null }[] = [
		{ name: 'half speed', clip: base, position: 96_000, x: 50 },
		{ name: 'reverse start', clip: { ...base, reversed: true }, position: 48_000, x: 100 },
		{ name: 'loop repetition', clip: { ...base, durationFrames: 144_000, opaqueExtensions: { ...(base as EditorAudioClip).opaqueExtensions as Readonly<Record<string, unknown>>,
			'org.soundscaper.clip-loop/v1': { periodFrames: 48_000, offsetFrames: 12_000 } } }, position: 96_000, x: 25 },
		{ name: 'warp marker', clip: { ...base, warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 24_000, mode: 'forward' }, { outer: 24_000, source: 60_000, mode: 'forward' },
			{ outer: 96_000, source: 72_000, mode: 'forward' },
		] } }, position: 72_000, x: 75 },
		{ name: 'outside clip', clip: base, position: 144_001, x: null },
	];
	try {
		for (const entry of cases) {
			telemetry = { positionFrame: entry.position };
			const project = { id: 'project', sampleRate: 48_000, clips: [entry.clip], tracks: [track],
				tempoMap: { mode: 'musical', events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } } as unknown as EditorProject;
			await act(async () => root.render(<PianoRollWorkspacePanel controller={controller} snapshot={{ project, selectedTrackId: 'track', selectedClipId: 'clip' }} copy={{}} blocked={false} run={operation => operation()} />));
			const cursor = dom.find('.kw-audio-editor__piano-roll-playhead');
			if (entry.x === null) assert.equal(cursor, null, entry.name);
			else { assert.ok(cursor, entry.name); assert.equal(Number.parseFloat((cursor.style as unknown as { left: string }).left), entry.x, entry.name); }
		}
	} finally {
		await act(async () => root.unmount());
		for (const [key, descriptor] of descriptors) {
			if (descriptor) Object.defineProperty(ReactTestElement.prototype, key, descriptor);
			else Reflect.deleteProperty(ReactTestElement.prototype, key);
		}
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
});
