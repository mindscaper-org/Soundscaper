/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PianoRollWorkspacePanel from '../src/common/editor/ui/workspace/PianoRollWorkspacePanel.tsx';
import { withMidiClipData, withMidiTrackData, readMidiClip, updateMidiNotesData, type MidiNote } from '../src/common/editor/midi-model.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { secondsToSampleFrame } from '../src/common/editor/timeline-time.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

test('a requested numeric pitch immediately reaches the existing selected-note preview', async context => {
	const fixture = await mount(context);
	await fixture.editPitch(67);
	fixture.preview();
	assert.deepEqual(fixture.previews, [67]);
	assert.equal(fixture.dom.one('[value="note"]').textContent, '67 · 0.000s');
	await fixture.resolve(0);
	fixture.preview();
	assert.deepEqual(fixture.previews, [67, 67]);
	assert.equal(fixture.errors.length, 0);
});

test('a failed numeric publication restores the persisted note for the next preview', async context => {
	const fixture = await mount(context);
	await fixture.editPitch(67);
	fixture.preview();
	assert.deepEqual(fixture.previews, [67]);
	await fixture.reject(0);
	fixture.preview();
	assert.deepEqual(fixture.previews, [67, 60]);
	assert.equal(fixture.dom.one('[value="note"]').textContent, '60 · 0.000s');
	assert.equal(fixture.errors.length, 1);
});

for (const firstFails of [false, true]) test(`an older numeric completion leaves a newer requested pitch intact (first fails:${firstFails})`, async context => {
	const fixture = await mount(context);
	await fixture.editPitch(67);
	await fixture.editPitch(68);
	if (firstFails) await fixture.reject(0); else await fixture.resolve(0);
	fixture.preview();
	assert.deepEqual(fixture.previews, [68]);
	assert.equal(fixture.dom.one('[value="note"]').textContent, '68 · 0.000s');
	if (firstFails) await fixture.resolve(1); else await fixture.reject(1);
	fixture.preview();
	assert.deepEqual(fixture.previews, [68, firstFails ? 68 : 67]);
	assert.equal(fixture.errors.length, 1);
});

test('rejecting an older pitch edit preserves a newer velocity projection', async context => {
	const fixture = await mount(context);
	await fixture.editPitch(62);
	await fixture.editVelocity(80);
	const paint = fixture.dom.one('[data-note-id="1"]').style.values.get('--note-fill');
	assert.ok(paint);
	await fixture.reject(0);
	fixture.preview();
	assert.deepEqual(fixture.previews, [60]);
	assert.equal(fixture.dom.one('[data-note-id="1"]').style.values.get('--note-fill'), paint);
	await fixture.resolve(1);
	assert.equal(fixture.errors.length, 1);
});

test('an older numeric publication retains the newer held note gesture and releases its completed projection', async context => {
	const fixture = await mount(context);
	await fixture.editDuration(.6);
	await fixture.beginDrag();
	await fixture.moveDrag();
	await fixture.resolve(0);
	fixture.preview();
	assert.equal(fixture.previews.at(-1), 61);
	assert.equal(String(Reflect.get(fixture.dom.one('[data-note-id="1"]').style, 'width')), '60px');
	await fixture.finishDrag();
	await fixture.resolve(1);
	fixture.preview();
	assert.equal(fixture.previews.at(-1), 61);
	await fixture.replacePersistedPitch(60);
	fixture.preview();
	assert.equal(fixture.previews.at(-1), 60, 'completed edits must not retain a stale optimistic owner');
});

async function mount(context: TestContext) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const canvas = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Map<string, Set<EventListener>>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (typeof listener !== 'function') return;
		const entries = listeners.get(type) ?? new Set<EventListener>(); entries.add(listener); listeners.set(type, entries);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (typeof listener === 'function') listeners.get(type)?.delete(listener); };
	const dispatch = async (type: string, event: object) => { await act(async () => {
		for (const listener of [...listeners.get(type) ?? []]) listener(event as Event);
	}); };
	const root = createRoot(dom.container as unknown as Element);
	const source = createAudioSource({ id: 'source', storageKey: 'pcm', name: 'Notes', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 });
	let clip = withMidiClipData(createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 0, sourceStartFrame: 0,
		durationFrames: 48_000, sourceDurationFrames: 48_000 }),
		{ version: 1, notes: [{ id: 'note', startFrame: 0, durationFrames: 24_000, pitch: 60, velocity: 100, channel: 0 }] });
	const track = withMidiTrackData(createAudioTrack({ id: 'track', name: 'Notes', clipIds: [clip.id], locked: false }), { version: 1, instrument: 'triangle' });
	const admitted = createCurrentAudioEditorProject({ id: 'numeric-preview', sources: [source], clips: [clip], tracks: [track] });
	const zero = secondsToSampleFrame(0, admitted.sampleRate);
	const makeProject = () => ({ ...admitted, sources: [source], clips: projectForRuntimeConsumers({ ...admitted, clips: [clip] }).clips,
		tracks: [track], projectBin: { ...admitted.projectBin, clips: [] },
		selection: { ...admitted.selection, startFrame: zero, endFrame: zero, trackIds: [], clipIds: [], annotationIds: [], frequencyRange: null },
		sequences: admitted.sequences.map(sequence => ({ ...sequence, trackNodes: sequence.trackNodes.map(node => ({ ...node })) })),
		trackFolders: admitted.trackFolders.map(folder => ({ ...folder })), takeGroups: admitted.takeGroups.map(group => ({ ...group })) });
	const requests: ReturnType<typeof deferred>[] = [], tasks: Promise<unknown>[] = [], previews: number[] = [], errors: unknown[] = [];
	const noop = () => undefined;
	const telemetry = { positionFrame: 0 };
	const controller = { subscribeTelemetry: () => noop, getTelemetrySnapshot: () => telemetry,
		actions: { midi: { addNote: noop, updateNote: noop,
			updateNotes(_clipId: string, updates: readonly { id: string; changes: Partial<MidiNote> }[]) {
				const gate = deferred(); requests.push(gate);
				return gate.promise.then(() => {
					const notes = readMidiClip(clip); assert.ok(notes);
					clip = withMidiClipData(clip, updateMidiNotesData(notes, updates)); render();
				});
			}, deleteNotes: noop, resizeClip: noop, setInstrument: noop, previewNote(pitch: number) { previews.push(pitch); } } } };
	const render = () => root.render(<PianoRollWorkspacePanel controller={controller}
		snapshot={{ project: makeProject(), selectedTrackId: track.id, selectedClipId: clip.id }} copy={{}} blocked={false}
		run={operation => {
			const result = operation(); if (!(result instanceof Promise)) return result;
			const task = result.catch(error => { errors.push(error); }); tasks.push(task); return task;
		}} />);
	context.after(async () => {
		await act(async () => { for (const request of requests) request.reject(new Error('Fixture disposed')); await Promise.allSettled(tasks); root.unmount(); });
		if (canvas) Object.defineProperty(ReactTestElement.prototype, 'getContext', canvas); else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		globals.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore();
	});
	await act(async () => { render(); });
	const selected = dom.one('.kw-audio-editor__piano-roll-note-editor').querySelector('select'); assert.ok(selected);
	await act(async () => { reactProps(selected).onChange?.({ currentTarget: { value: 'note' } }); });
	const editField = async (label: string, value: number) => {
		const field = dom.one('.kw-audio-editor__piano-roll-note-editor').querySelectorAll('label')
			.find(candidate => candidate.textContent === label);
		const input = field?.querySelector('input'); assert.ok(input);
		await act(async () => { reactProps(input).onFocus?.({}); reactProps(input).onChange?.({ currentTarget: { value: String(value) } }); });
		await act(async () => { reactProps(input).onBlur?.({}); });
	};
	return { dom, previews, errors, editPitch: (value: number) => editField('Pitch (MIDI number)', value),
		editVelocity: (value: number) => editField('Velocity', value),
		editDuration: (value: number) => editField('Note duration (seconds)', value),
		async beginDrag() { await act(async () => {
			const target = dom.one('[data-note-id="1"]'); target.getBoundingClientRect = () => ({ left: 0, width: 60 });
			reactProps(dom.one('.kw-audio-editor__piano-roll-notes')).onMouseDownCapture?.({ target });
			reactProps(target).onMouseDown?.({ currentTarget: target, button: 0, clientX: 10, clientY: 56, preventDefault() {}, stopPropagation() {} });
		}); },
		moveDrag: () => dispatch('mousemove', { button: 0, buttons: 1, clientX: 10, clientY: 40 }),
		finishDrag: () => dispatch('mouseup', { button: 0 }),
		async replacePersistedPitch(pitch: number) { await act(async () => {
			const data = readMidiClip(clip); assert.ok(data);
			clip = withMidiClipData(clip, updateMidiNotesData(data, [{ id: 'note', changes: { pitch } }])); render();
		}); },
		preview() { const button = dom.container.querySelectorAll('button').find(candidate => candidate.textContent === 'Preview selected note'); assert.ok(button); reactProps(button).onClick?.({}); },
		async resolve(index: number) { await act(async () => { requests[index]!.resolve(); await Promise.allSettled(tasks.slice(0, index + 1)); }); },
		async reject(index: number) { await act(async () => { requests[index]!.reject(new Error('Write failed')); await Promise.allSettled(tasks.slice(0, index + 1)); }); },
	};
}

function deferred() {
	let resolve = () => {}, reject = (_reason: unknown) => {};
	const promise = new Promise<void>((accepted, refused) => { resolve = accepted; reject = refused; });
	return { promise, resolve, reject };
}
