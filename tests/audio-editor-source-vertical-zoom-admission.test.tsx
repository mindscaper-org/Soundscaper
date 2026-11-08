/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipSourceEditor from '../src/common/editor/ui/inspector/ClipSourceEditor.tsx';
import type { ClipSourceController, ClipSourceProject } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const copy = { waveformView: 'Waveform', spectrogramView: 'Spectrogram', multiview: 'Multi-view', halfWave: 'Half-wave',
	threeBandWaveformView: 'Three-band waveform', rainbowWaveformView: 'Rainbow waveform', zoomIn: 'Zoom in', zoomOut: 'Zoom out' };

test('Source pure Spectrogram does not offer waveform-only vertical zoom', async context => {
	const f = await mount(context);
	await f.choose('Spectrogram'); await f.open();
	assert.equal(f.item('Zoom in').getAttribute('aria-disabled'), 'true');
	assert.equal(f.item('Zoom out').getAttribute('aria-disabled'), 'true');
});

for (const mode of ['Waveform', 'Multi-view']) test(`Source ${mode} retains its visible amplitude zoom`, async context => {
	const f = await mount(context);
	await f.choose(mode); await f.open();
	assert.notEqual(f.item('Zoom in').getAttribute('aria-disabled'), 'true');
	assert.equal(f.zoomed(), false);
	await f.choose('Zoom in'); assert.equal(f.zoomed(), true);
	await f.choose('Zoom out'); assert.equal(f.zoomed(), false);
});

test('unavailable Spectrogram zoom cannot silently alter the retained waveform view', async context => {
	const f = await mount(context);
	await f.choose('Zoom in'); assert.equal(f.zoomed(), true);
	await f.choose('Spectrogram'); await f.choose('Zoom out');
	await f.choose('Waveform'); assert.equal(f.zoomed(), true);
});

for (const mode of ['Half-wave', 'Three-band waveform', 'Rainbow waveform']) test(`Source ${mode} retains waveform zoom admission`, async context => {
	const f = await mount(context);
	await f.choose(mode); await f.open();
	for (const action of ['Zoom in', 'Zoom out']) assert.notEqual(f.item(action).getAttribute('aria-disabled'), 'true');
});

test('Source waveform zoom remains a nonmutating view action on a locked track', async context => {
	const f = await mount(context, true);
	await f.choose('Zoom in'); assert.equal(f.zoomed(), true);
	assert.deepEqual(f.mutations, []);
});

async function mount(context: TestContext, blocked = false) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT, previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React'); dom.restore(); });
	const source = createAudioSource({ id: 'source', sampleRate: 48000, frameCount: 48000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48000, durationFrames: 48000 });
	const track = createAudioTrack({ id: 'track', clipIds: [clip.id], locked: blocked });
	const admitted = createCurrentAudioEditorProject({ id: 'source-zoom', sampleRate: 48000, sources: [source], clips: [clip], tracks: [track] });
	const project: ClipSourceProject = { id: admitted.id, sampleRate: admitted.sampleRate, tempoMap: admitted.tempoMap, sources: [source],
		clips: [{ ...clip, timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48000, durationFrames: 48000 }] };
	const mutations: unknown[][] = [], noop = () => undefined;
	const controller: ClipSourceController = { getClipVisualData: () => null, actions: {
		clip: { update: (...args) => { mutations.push(args); } }, effects: { setSourceSelection: noop }, timeline: {},
		audioWarp: { addSourceMarker: noop, moveSourceMarker: noop, deleteSourceMarker: noop },
		clipSourcePreview: { focus: noop, blur: noop, playPause: noop, stop: noop, seek: noop, setLoop: noop, setLoopRange: noop, setSelection: noop, trim: noop,
			subscribe: () => noop, snapshot: () => ({ clipId: 'clip', focused: false, state: 'stopped', positionFrame: 0, loop: false, loopRange: null }) },
	} };
	await act(async () => root.render(<ClipSourceEditor controller={controller} project={project} clipId="clip" copy={copy} blocked={blocked} previewBlocked={false} run={operation => operation()} />));
	const vertical = dom.one('.audio-editor-source-vertical-ruler');
	const open = async () => { await act(async () => reactProps(vertical).onContextMenu?.({ clientX: 20, clientY: 20, preventDefault() {} })); };
	const item = (label: string) => {
		const element = dom.container.querySelectorAll('[role="menuitem"]').find(element => element.querySelector('.context-menu-item-label')?.textContent === label);
		assert.ok(element, `Expected existing Source menu item ${label}`); return element;
	};
	return { mutations, open, item, zoomed: () => dom.container.querySelector('.audio-editor-zoomed-db-ruler') !== null,
		async choose(label: string) { await open(); await act(async () => reactProps(item(label)).onClick?.({ detail: 1 })); },
	};
}
