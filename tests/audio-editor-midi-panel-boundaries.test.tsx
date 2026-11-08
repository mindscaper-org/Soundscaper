/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PianoRollWorkspacePanel from '../src/common/editor/ui/workspace/PianoRollWorkspacePanel.tsx';
import { withMidiClipData, withMidiTrackData } from '../src/common/editor/midi-model.ts';
import type { EditorAudioClip, EditorProject } from '../src/common/editor/types.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

test('untrimming a MIDI clip at project zero keeps its opposite edge fixed', async () => {
	const changes = await resizeSourceEdge({}, 'left', -50);
	assert.deepEqual(changes, [{ clipId: 'clip', changes: { timelineStartFrame: 0, sourceStartFrame: 24_000, durationFrames: 48_000 } }]);
});

test('trimming the low source edge of reversed MIDI changes its timeline end', async () => {
	const changes = await resizeSourceEdge({ reversed: true }, 'left', 25);
	assert.deepEqual(changes, [{ clipId: 'clip', changes: { timelineStartFrame: 0, sourceStartFrame: 36_000, durationFrames: 36_000 } }]);
});

test('MIDI source-edge edits preserve speed when source and project sample clocks differ', async () => {
	const changes = await resizeSourceEdge({ timelineStartFrame: 24_000, durationFrames: 48_000 }, 'right', -25, 24_000);
	assert.deepEqual(changes, [{ clipId: 'clip', changes: { timelineStartFrame: 24_000, sourceStartFrame: 24_000, durationFrames: 36_000 } }]);
});

async function resizeSourceEdge(overrides: Partial<EditorAudioClip>, edge: 'left' | 'right', deltaX: number, projectRate = 48_000): Promise<unknown[]> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const context = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Map<string, Set<EventListener>>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (typeof listener !== 'function') return;
		const entries = listeners.get(type) ?? new Set<EventListener>(); entries.add(listener); listeners.set(type, entries);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (typeof listener === 'function') listeners.get(type)?.delete(listener); };
	const root = createRoot(dom.container as unknown as Element);
	const calls: unknown[] = [];
	const noop = () => undefined;
	const telemetry = { positionFrame: 0 };
	const controller = { subscribeTelemetry: () => noop, getTelemetrySnapshot: () => telemetry,
		actions: { midi: { addNote: noop, updateNote: noop, updateNotes: noop, deleteNotes: noop,
			resizeClip: (clipId: string, changes: unknown) => { calls.push({ clipId, changes }); }, setInstrument: noop, previewNote: noop } } };
	const clip = withMidiClipData({ kind: 'audio' as const, id: 'clip', sourceId: 'source', title: 'Notes', timelineStartFrame: 0,
		sourceStartFrame: 24_000, sourceDurationFrames: 48_000, durationFrames: 48_000, ...overrides }, { version: 1, notes: [] });
	const track = withMidiTrackData({ type: 'audio' as const, id: 'track', name: 'Notes', clipIds: ['clip'], height: 114, collapsed: false, locked: false }, { version: 1, instrument: 'sine' });
	const project = { id: 'project', sampleRate: projectRate, clips: [clip], tracks: [track], sources: [{ kind: 'audio', id: 'source', sampleRate: 48_000 }] } as unknown as EditorProject;
	try {
		await act(async () => root.render(<PianoRollWorkspacePanel controller={controller} snapshot={{ project, selectedTrackId: 'track', selectedClipId: 'clip' }} copy={{}} blocked={false} run={operation => operation()} />));
		const handle = dom.container.querySelectorAll('div').find(node => {
			const style = reactProps(node).style as unknown as { cursor?: string; left?: number; right?: number; width?: number };
			return style?.cursor === 'ew-resize' && style.width === 6 && style[edge] === 0;
		});
		assert.ok(handle, `${edge} source trim handle`);
		await act(async () => {
			reactProps(dom.one('.kw-audio-editor__piano-roll-notes')).onMouseDownCapture?.({});
			reactProps(handle).onMouseDown?.({ button: 0, clientX: 100, preventDefault() {}, stopPropagation() {} });
		});
		await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 100 + deltaX } as MouseEvent); });
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({} as MouseEvent); });
		return calls;
	} finally {
		await act(async () => root.unmount());
		if (context) Object.defineProperty(ReactTestElement.prototype, 'getContext', context);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
}
