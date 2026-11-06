/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import PianoRollWorkspacePanel from '../src/common/editor/ui/workspace/PianoRollWorkspacePanel.tsx';
import { withMidiClipData, withMidiTrackData, type MidiNote } from '../src/common/editor/midi-model.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { installReactTestDom, ReactTestElement, reactProps } from './helpers/react-test-dom.ts';

const placements = ['sample', 'musical', 'fixed samples', 'reversed', 'stretched', 'cross rate', 'looped', 'warped'] as const;
type Placement = typeof placements[number];
interface Resize { readonly timelineStartFrame: number; readonly sourceStartFrame: number; readonly durationFrames: number }

for (const placement of placements) test(`${placement} canonical MIDI clip publishes resolved strip resize coordinates`, async () => {
	await withPanel(placement, async fixture => {
		const { dom, requests, sourceRate } = fixture;
		const cursor = dom.find('.kw-audio-editor__piano-roll-playhead');
		const cursorX = cursor ? String(Reflect.get(cursor.style, 'left')) : null;
		await fixture.resize('right', -25);
		const stretched = placement === 'stretched', reversed = placement === 'reversed', looped = placement === 'looped';
		const durationFrames = placement === 'warped' ? 24_000 : stretched ? 72_000 : looped ? 132_000 : 36_000;
		assert.deepEqual(requests, [{ timelineStartFrame: reversed ? 60_000 : 48_000, sourceStartFrame: 0, durationFrames }]);
		assert.equal(requests.every(request => Object.values(request).every(Number.isSafeInteger)), true);
		assert.equal(cursorX, `${fixture.playheadX}px`);
		const add = dom.container.querySelectorAll('button').find(node => node.textContent === 'Add note'); assert.ok(add);
		await act(async () => { reactProps(add).onClick?.({}); });
		assert.equal(fixture.added[0]?.startFrame, 0, 'source editing stays local after timeline placement and transforms');
		assert.equal(fixture.added[0]?.durationFrames, sourceRate / 8);
	});
});

test('left resizing an admitted musical clip keeps its existing timeline right edge', async () => {
	await withPanel('musical', async fixture => {
		await fixture.resize('left', 25);
		assert.deepEqual(fixture.requests, [{ timelineStartFrame: 60_000, sourceStartFrame: 12_000, durationFrames: 36_000 }]);
	});
});

async function withPanel(placement: Placement, check: (fixture: Awaited<ReturnType<typeof mount>>) => Promise<void>): Promise<void> {
	const fixture = await mount(placement);
	try { await check(fixture); } finally { await fixture.dispose(); }
}

async function mount(placement: Placement) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const canvas = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	const bounds = ReactTestElement.prototype.getBoundingClientRect;
	ReactTestElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 400 });
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Map<string, Set<EventListener>>();
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
		if (typeof listener !== 'function') return;
		const callbacks = listeners.get(type) ?? new Set<EventListener>(); callbacks.add(listener); listeners.set(type, callbacks);
	};
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (typeof listener === 'function') listeners.get(type)?.delete(listener); };
	const sourceRate = placement === 'cross rate' ? 16_000 : 48_000;
	const source = createAudioSource({ id: 'source', name: 'Native notes', storageKey: 'pcm', sampleRate: sourceRate, frameCount: sourceRate, channelCount: 1 });
	const tempoMap = { mode: 'musical' as const, events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] };
	const durationFrames = placement === 'looped' ? 144_000 : placement === 'stretched' ? 96_000 : 48_000;
	const clip = withMidiClipData(createAudioClip({ id: 'clip', title: 'Native notes', sourceId: source.id, sourceStartFrame: 0, sourceDurationFrames: sourceRate,
		...(placement === 'sample' || placement === 'looped' ? { timelineStartFrame: 48_000, durationFrames } : {
			anchor: 'musical', musicalStartBeat: 2,
			...(placement === 'fixed samples' ? { musicalExtent: 'fixedSamples', durationFrames } : { musicalExtent: 'beat', musicalDurationBeats: durationFrames / 24_000 }),
		}), reversed: placement === 'reversed',
		...(placement === 'looped' ? { opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: 48_000, offsetFrames: 0 } } } : {}),
		...(placement === 'warped' ? { warpMap: { feature: 'audio-warp', points: [
			{ outer: { num: 0, den: 1 }, source: { num: 0, den: 1 }, mode: 'forward' },
			{ outer: { num: 1, den: 1 }, source: { num: 36_000, den: 1 }, mode: 'forward' },
			{ outer: { num: 2, den: 1 }, source: { num: 48_000, den: 1 }, mode: 'forward' },
		] } } : {}),
	}, { projectSampleRate: 48_000, tempoMap }), { version: 1, notes: [{ id: 'note', startFrame: 0, durationFrames: sourceRate / 2, pitch: 60, velocity: 100, channel: 0 }] });
	const track = withMidiTrackData(createAudioTrack({ id: 'track', clipIds: [clip.id], locked: false }), { version: 1, instrument: 'sine' });
	const admitted = createCurrentAudioEditorProject({ id: 'canonical-midi', sampleRate: 48_000, tempoMap, sources: [source], clips: [clip], tracks: [track] });
	const project = { ...admitted, sources: [source], clips: [clip], tracks: [track] };
	if (placement !== 'sample' && placement !== 'looped') assert.equal(Object.hasOwn(project.clips[0], 'timelineStartFrame'), false, 'fixture must retain canonical musical authority');
	if (placement !== 'sample' && placement !== 'looped' && placement !== 'fixed samples') assert.equal(Object.hasOwn(project.clips[0], 'durationFrames'), false);
	const requests: Resize[] = [], added: MidiNote[] = [];
	const noop = () => undefined, telemetry = { positionFrame: 60_000 };
	const controller = { subscribeTelemetry: () => noop, getTelemetrySnapshot: () => telemetry, actions: { midi: {
		addNote: (_id: string, note: MidiNote) => { added.push(note); }, updateNote: noop, updateNotes: noop, deleteNotes: noop,
		resizeClip: (_id: string, changes: Resize) => { requests.push(changes); }, setInstrument: noop, previewNote: noop,
	} } };
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<PianoRollWorkspacePanel controller={controller} snapshot={{ project, selectedTrackId: track.id, selectedClipId: clip.id }} copy={{}} blocked={false} run={operation => operation()} />));
	const dispatch = async (type: string, event: object) => { await act(async () => { for (const listener of [...listeners.get(type) ?? []]) listener(event as Event); }); };
	return { dom, requests, added, sourceRate,
		playheadX: placement === 'reversed' ? 75 : placement === 'stretched' ? 12.5 : placement === 'warped' ? 37.5 : 25,
		async resize(edge: 'left' | 'right', delta: number) {
			const name = dom.container.querySelectorAll('span').find(node => node.textContent === 'Native notes');
			assert.ok(name?.parentNode instanceof ReactTestElement);
			const handle = name.parentNode.childNodes[edge === 'left' ? 1 : 2]; assert.ok(handle instanceof ReactTestElement);
			await act(async () => {
				reactProps(dom.one('.kw-audio-editor__piano-roll-notes')).onMouseDownCapture?.({ target: handle });
				reactProps(handle).onMouseDown?.({ button: 0, clientX: 0, preventDefault() {}, stopPropagation() {} });
			});
			await dispatch('mousemove', { clientX: delta });
			await dispatch('mouseup', { button: 0 });
		},
		async dispose() {
			await act(async () => root.unmount());
			ReactTestElement.prototype.getBoundingClientRect = bounds;
			if (canvas) Object.defineProperty(ReactTestElement.prototype, 'getContext', canvas); else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
			globals.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore();
		},
	};
}
