/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PianoRollWorkspacePanel from '../src/common/editor/ui/workspace/PianoRollWorkspacePanel.tsx';
import { withMidiClipData, withMidiTrackData, type MidiNote } from '../src/common/editor/midi-model.ts';
import type { EditorProject } from '../src/common/editor/types.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

test('Delete retires a held note drag and its unpublished host updates', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const descriptors = new Map(['getContext', 'getBoundingClientRect'].map(key => [key, Object.getOwnPropertyDescriptor(ReactTestElement.prototype, key)]));
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', { configurable: true,
	value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 600, width: 1200, height: 600 }) });
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Map<string, Set<EventListener>>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
	if (typeof listener !== 'function') return;
	const entries = listeners.get(type) ?? new Set<EventListener>(); entries.add(listener); listeners.set(type, entries);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
	if (typeof listener === 'function') listeners.get(type)?.delete(listener);
	};
	const updates: (readonly { id: string; changes: Partial<MidiNote> }[])[] = [];
	const deleted: string[][] = [];
	const noop = () => undefined;
	const telemetry = { positionFrame: 0 };
	const clip = withMidiClipData({ kind: 'audio' as const, id: 'clip', sourceId: 'source', title: 'Notes', timelineStartFrame: 0,
	sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 }, { version: 1, notes: [
	{ id: 'note', pitch: 60, velocity: 100, channel: 0, startFrame: 0, durationFrames: 24_000 },
	] });
	const track = withMidiTrackData({ type: 'audio' as const, id: 'track', name: 'Notes', clipIds: ['clip'], height: 114,
	collapsed: false, locked: false }, { version: 1, instrument: 'sine' });
	let project = { id: 'project', sampleRate: 48_000, tracks: [track], clips: [clip] } as unknown as EditorProject;
	const root = createRoot(dom.container as unknown as Element);
	const controller = { subscribeTelemetry: () => noop, getTelemetrySnapshot: () => telemetry, actions: { midi: {
	addNote: noop, updateNote: noop, resizeClip: noop, setInstrument: noop, previewNote: noop,
	updateNotes: (_clipId: string, changes: readonly { id: string; changes: Partial<MidiNote> }[]) => { updates.push(changes); },
	deleteNotes: (_clipId: string, ids: readonly string[]) => {
	deleted.push([...ids]); project = { ...project, clips: [withMidiClipData(clip, { version: 1, notes: [] })] }; render();
	},
	} } };
	const render = () => root.render(<PianoRollWorkspacePanel controller={controller} snapshot={{ project, selectedTrackId: 'track',
	selectedClipId: 'clip' }} copy={{}} blocked={false} run={operation => operation()} />);
	try {
	await act(async () => { render(); });
	const note = dom.one('[data-note-id="1"]'); note.getBoundingClientRect = () => ({ left: 0, width: 50 });
	await act(async () => {
	reactProps(dom.one('.kw-audio-editor__piano-roll-notes')).onMouseDownCapture?.({});
	reactProps(note).onMouseDown?.({ currentTarget: note, button: 0, clientX: 20, clientY: 20, preventDefault() {}, stopPropagation() {} });
	});
	await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 45, clientY: 20 } as MouseEvent); });
	const grid = dom.one('.kw-audio-editor__piano-roll-notes').querySelector('[tabindex="0"]'); assert.ok(grid);
	await act(async () => { reactProps(grid).onKeyDown?.({ key: 'Delete', stopPropagation() {} }); });
	assert.deepEqual(deleted, [['note']]);
	await act(async () => { for (const listener of listeners.get('mousemove') ?? []) listener({ clientX: 70, clientY: 20 } as MouseEvent); });
	await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({ button: 0 } as MouseEvent); });
	assert.deepEqual(updates, [], 'deleted note must not receive a later gesture commit');
	} finally {
	await act(async () => root.unmount());
	for (const [key, descriptor] of descriptors) {
	if (descriptor) Object.defineProperty(ReactTestElement.prototype, key, descriptor); else Reflect.deleteProperty(ReactTestElement.prototype, key);
	}
	globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore();
	}
});
