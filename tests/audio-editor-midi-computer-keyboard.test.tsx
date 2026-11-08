/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PianoRollWorkspacePanel from '../src/common/editor/ui/workspace/PianoRollWorkspacePanel.tsx';
import { withMidiClipData, withMidiTrackData } from '../src/common/editor/midi-model.ts';
import type { EditorProject } from '../src/common/editor/types.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

test('enabling the computer keyboard immediately admits note/octave keys while text fields keep editing keys', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const context = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	const root = createRoot(dom.container as unknown as Element);
	const noop = () => undefined;
	const telemetry = { positionFrame: 0 };
	const previews: number[] = [];
	const controller = { subscribeTelemetry: () => noop, getTelemetrySnapshot: () => telemetry,
		actions: { midi: { addNote: noop, updateNote: noop, updateNotes: noop, deleteNotes: noop, resizeClip: noop, setInstrument: noop,
			previewNote: (pitch: number) => { previews.push(pitch); } } } };
	const clip = withMidiClipData({ kind: 'audio' as const, id: 'clip', sourceId: 'source', title: 'Notes',
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 }, { version: 1, notes: [] });
	const track = withMidiTrackData({ type: 'audio' as const, id: 'track', name: 'Notes', clipIds: ['clip'], height: 114, collapsed: false, locked: false }, { version: 1, instrument: 'sine' });
	const project = { id: 'project', sampleRate: 48_000, tracks: [track], clips: [clip] } as unknown as EditorProject;
	try {
		await act(async () => root.render(<PianoRollWorkspacePanel controller={controller} snapshot={{ project, selectedTrackId: 'track', selectedClipId: 'clip' }} copy={{}} blocked={false} run={operation => operation()} />));
		const keyboard = dom.container.querySelectorAll('input').filter(input => input.type === 'checkbox')[1];
		assert.ok(keyboard);
		keyboard.setAttribute('type', 'checkbox'); // Match native type-property reflection in the test DOM.
		await act(async () => { reactProps(keyboard).onChange?.({ currentTarget: { checked: true } }); });
		const panel = dom.one('.kw-audio-editor__piano-roll');
		for (const key of ['x', 'a']) await act(async () => { reactProps(panel).onKeyDown?.({ key, target: keyboard, preventDefault() {}, stopPropagation() {} }); });
		assert.deepEqual(previews, [60]);
		const octave = dom.container.querySelectorAll('input').find(input => input.getAttribute('title')?.includes('A–K'));
		assert.equal(octave?.value, '4');
		await act(async () => { reactProps(panel).onKeyDown?.({ key: 'a', target: octave, preventDefault() {}, stopPropagation() {} }); });
		assert.deepEqual(previews, [60]);
		assert.ok(octave);
		await act(async () => { reactProps(octave).onFocus?.(); });
		await act(async () => { reactProps(octave).onChange?.({ currentTarget: { value: '' } }); });
		assert.equal(octave.value, '', 'an incomplete signed octave must stay editable');
		await act(async () => { reactProps(octave).onChange?.({ currentTarget: { value: '-1' } }); });
		await act(async () => { reactProps(octave).onBlur?.(); });
		await act(async () => { reactProps(panel).onKeyDown?.({ key: 'a', target: keyboard, preventDefault() {}, stopPropagation() {} }); });
		assert.deepEqual(previews, [60, 0]);
	} finally {
		await act(async () => root.unmount());
		if (context) Object.defineProperty(ReactTestElement.prototype, 'getContext', context);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
});
