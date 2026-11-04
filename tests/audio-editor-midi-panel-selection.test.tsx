/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PianoRollWorkspacePanel from '../src/common/editor/ui/workspace/PianoRollWorkspacePanel.tsx';
import { withMidiClipData, withMidiTrackData } from '../src/common/editor/midi-model.ts';
import type { EditorProject } from '../src/common/editor/types.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

test('Ctrl-click removes an already selected MIDI note from the next Delete', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
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
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (typeof listener === 'function') listeners.get(type)?.delete(listener); };
	const deleted: string[][] = [];
	const noop = () => undefined;
	const telemetry = { positionFrame: 0 };
	const controller = { subscribeTelemetry: () => noop, getTelemetrySnapshot: () => telemetry,
		actions: { midi: { addNote: noop, updateNote: noop, updateNotes: noop, resizeClip: noop, setInstrument: noop, previewNote: noop,
			deleteNotes: (_clipId: string, ids: readonly string[]) => { deleted.push([...ids]); } } } };
	const clip = withMidiClipData({ kind: 'audio' as const, id: 'clip', sourceId: 'source', title: 'Notes', timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 96_000, durationFrames: 96_000 }, { version: 1, notes: [
		{ id: 'first', pitch: 60, velocity: 100, channel: 0, startFrame: 0, durationFrames: 24_000 },
		{ id: 'second', pitch: 62, velocity: 100, channel: 0, startFrame: 48_000, durationFrames: 24_000 },
	] });
	const track = withMidiTrackData({ type: 'audio' as const, id: 'track', name: 'Notes', clipIds: ['clip'], height: 114, collapsed: false, locked: false }, { version: 1, instrument: 'sine' });
	const project = { id: 'project', sampleRate: 48_000, tracks: [track], clips: [clip] } as unknown as EditorProject;
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<PianoRollWorkspacePanel controller={controller} snapshot={{ project, selectedTrackId: 'track', selectedClipId: 'clip' }} copy={{}} blocked={false} run={operation => operation()} />));
		const grid = dom.one('[tabindex="0"]');
		await act(async () => { reactProps(grid).onKeyDown?.({ key: 'a', ctrlKey: true, preventDefault() {}, stopPropagation() {} }); });
		await act(async () => {
			reactProps(dom.one('.kw-audio-editor__piano-roll-notes')).onMouseDownCapture?.({});
			reactProps(dom.one('[data-note-id="1"]')).onMouseDown?.({ button: 0, ctrlKey: true, clientX: 20, clientY: 20, preventDefault() {}, stopPropagation() {} });
		});
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({} as MouseEvent); });
		await act(async () => { reactProps(grid).onKeyDown?.({ key: 'Delete', stopPropagation() {} }); });
		assert.deepEqual(deleted, [['second']]);
		await act(async () => {
			reactProps(dom.one('.kw-audio-editor__piano-roll-notes')).onMouseDownCapture?.({});
			reactProps(dom.one('[data-note-id="1"]')).onMouseDown?.({ button: 0, ctrlKey: true, clientX: 20, clientY: 20, preventDefault() {}, stopPropagation() {} });
		});
		await act(async () => { for (const listener of [...listeners.get('mouseup') ?? []]) listener({} as MouseEvent); });
		await act(async () => { reactProps(grid).onKeyDown?.({ key: 'Delete', stopPropagation() {} }); });
		assert.deepEqual(deleted, [['second'], ['first', 'second']], 'adding a note must toggle once across mouse down/up');
	} finally {
		await act(async () => root.unmount());
		for (const [key, descriptor] of descriptors) {
			if (descriptor) Object.defineProperty(ReactTestElement.prototype, key, descriptor);
			else Reflect.deleteProperty(ReactTestElement.prototype, key);
		}
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
});
