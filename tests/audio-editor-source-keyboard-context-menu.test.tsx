/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipSourceEditor from '../src/common/editor/ui/inspector/ClipSourceEditor.tsx';
import type { ClipSourceController, ClipSourceProject } from '../src/common/editor/ui/inspector/clip-source-editor-types.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const key of ['ContextMenu', 'F10']) test(`Source waveform ${key} opens its existing menu at the current source playhead`, async context => {
	const fixture = await mount(context);
	const handled = await fixture.key({ key, shiftKey: key === 'F10' });
	assert.equal(handled, true);
	const item = fixture.item('Add stretch marker'); assert.ok(item);
	await act(async () => { reactProps(item).onClick?.({ detail: 0 }); });
	assert.deepEqual(fixture.markers, [['clip', 12_000]], 'source-frame coordinates must follow the half-second playhead, not the old pointer');
});

for (const owned of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented', 'nested'] as const) test(`Source waveform keeps ${owned} menu keys with their owner`, async context => {
	const fixture = await mount(context);
	assert.equal(await fixture.key({ key: 'F10', shiftKey: true, ...(owned === 'nested' ? {} : { [owned]: true }) }, owned === 'nested'), false);
	assert.equal(fixture.dom.container.querySelectorAll('[role="menu"]').length, 0);
});

test('locked Source context still offers listening actions while marker mutation stays disabled', async context => {
	const fixture = await mount(context, true);
	assert.equal(await fixture.key({ key: 'ContextMenu', shiftKey: false }), true);
	assert.equal(fixture.item('Add stretch marker')?.getAttribute('aria-disabled'), 'true');
	assert.notEqual(fixture.item('All')?.getAttribute('aria-disabled'), 'true');
	assert.notEqual(fixture.item('Fit source')?.getAttribute('aria-disabled'), 'true');
	assert.deepEqual(fixture.markers, []);
});

test('the native pointer context-menu path keeps its pointed source frame', async context => {
	const fixture = await mount(context);
	await act(async () => { reactProps(fixture.wave).onContextMenu?.({ clientX: 578, clientY: 350, preventDefault() {} }); });
	const item = fixture.item('Add stretch marker'); assert.ok(item);
	await act(async () => { reactProps(item).onClick?.({ detail: 1 }); });
	assert.deepEqual(fixture.markers, [['clip', 18_000]]);
});

async function mount(context: TestContext, blocked = false) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT, priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => { await act(async () => { root.unmount(); }); globals.IS_REACT_ACT_ENVIRONMENT = prior;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React'); dom.restore(); });
	const source = createAudioSource({ id: 'source', sampleRate: 24_000, channelCount: 1, frameCount: 24_000 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 24_000, durationFrames: 48_000 });
	const track = createAudioTrack({ id: 'track', clipIds: [clip.id], locked: blocked });
	const admitted = createCurrentAudioEditorProject({ id: 'source-menu', sampleRate: 48_000, sources: [source], clips: [clip], tracks: [track] });
	const project: ClipSourceProject = { id: admitted.id, sampleRate: admitted.sampleRate, tempoMap: admitted.tempoMap, sources: [source],
		clips: [{ ...clip, timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 24_000, durationFrames: 48_000 }] };
	const markers: unknown[][] = [], noop = () => undefined;
	const controller: ClipSourceController = { getClipVisualData: () => null, actions: { clip: { update: noop }, timeline: {}, effects: { setSourceSelection: noop },
		audioWarp: { addSourceMarker: (...args) => { markers.push(args); }, moveSourceMarker: noop, deleteSourceMarker: noop },
		clipSourcePreview: { focus: noop, blur: noop, playPause: noop, stop: noop, seek: noop, setLoop: noop, setLoopRange: noop, setSelection: noop, trim: noop,
			subscribe: () => noop, snapshot: () => ({ clipId: 'clip', focused: false, state: 'stopped', positionFrame: 24_000, loop: false, loopRange: null }) },
	} };
	await act(async () => { root.render(<ClipSourceEditor controller={controller} project={project} clipId="clip" blocked={blocked} previewBlocked={false}
		copy={{ clipSourceWaveform: 'Source waveform', clipSourceAddMarker: 'Add stretch marker', selectAll: 'All', clipSourceFit: 'Fit source' }} run={operation => operation()} />); });
	const wave = dom.one('.audio-editor-source-wave-area');
	wave.getBoundingClientRect = () => ({ left: 200, top: 300, right: 704, bottom: 500, width: 504, height: 200 });
	return { dom, wave, markers,
		item: (name: string) => dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent === name),
		async key(extra: Readonly<Record<string, unknown>>, nested = false) {
			let prevented = false;
			const target: ReactTestElement = nested ? dom.one('.audio-editor-source-trim--start') : wave;
			await act(async () => { reactProps(wave).onKeyDown?.({ target, currentTarget: wave, preventDefault() { prevented = true; }, stopPropagation() {}, ...extra }); });
			return prevented;
		},
	};
}
