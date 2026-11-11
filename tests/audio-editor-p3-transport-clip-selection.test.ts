/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { evaluateAudacityActionEnablement } from '../src/common/editor/audacity-action-parity.js';
import { PlaySpeedFlyout } from '../src/common/editor/ui/toolbar/AudioEditorTransportControls.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

type Session = Awaited<ReturnType<typeof controllerSession>>;
type Fixture = ReturnType<typeof mountControllerDataDom>;
function Menu({ controller, fixture }: Readonly<{ controller: Session['controller']; fixture: Fixture }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return React.createElement(PlaySpeedFlyout, { controller, snapshot, copy: ENGLISH_COPY, blocked: false, run: fixture.run });
}

for (const action of ['selection', 'cut'] as const) for (const anchor of ['sample', 'musical'] as const) {
	test(`P3-021: ${action} audition resolves the selected ${anchor} clip after native File Open`, async context => {
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
		const pcm = [new Float32Array(48_000).fill(.25)];
		const clip = createAudioClip({ id: 'clip', title: 'Voice recording', sourceId: source.id, sourceStartFrame: 0, sourceDurationFrames: 48_000,
			...(anchor === 'sample' ? { timelineStartFrame: 24_000, durationFrames: 48_000 }
				: { anchor: 'musical', musicalStartBeat: 1, musicalExtent: 'beat', musicalDurationBeats: 2 }) });
		const project = createSoundscaperProject({ id: `p3-transport-${anchor}`, sources: [source], clips: [clip],
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] })],
			selection: { startFrame: 0, endFrame: 0, trackIds: ['voice'], clipIds: ['clip'] } });
		const donor = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		const native = createSoundscaperScapeNativeRuntime();
		let blob: Blob;
		try {
			const writer = await donor.beginSourceWrite(source.storageKey, source);
			await writer.write(pcm); await writer.commit();
			const archive = await native.exportScapeProject(project, donor); assert.ok(archive.blob); blob = archive.blob;
		} finally { await donor.close(); }
		const calls: unknown[] = [];
		const engine = { ...createMemoryEngine(),
			decodeAudioData: async () => assert.fail('Scape PCM must not use a substitute decoder'),
			playCutPreview: async (range: unknown) => { calls.push(range); },
			setPlayRange: (range: unknown) => { calls.push(range); return range; },
		};
		type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
		const { controller, store } = await controllerSession(context, { scapeProjectRuntime: native,
			engine: engine as unknown as Options['engine'], engineFactory: () => { throw new Error('Menu admission must not substitute rendered audio'); } });
		await controller.actions.project.openScapeFile(new File([blob], 'Voice.sscape'), () => 'copy');
		const admitted = clipboardProject(controller.project);
		assert.deepEqual(clipboardDocument(admitted), clipboardDocument(project));
		assert.equal(controller.getSnapshot().readOnly, false);
		assert.deepEqual(admitted.selection, { startFrame: 0, endFrame: 0, trackIds: ['voice'], clipIds: ['clip'], frequencyRange: null, annotationIds: [] });
		assertPcmChannelsEqual(await readCustodyPcm(store, source), pcm, 'every admitted original Voice sample');
		if (action === 'selection') {
			const fixture = mountControllerDataDom(), history = structuredClone(controller.getSnapshot().history);
			const item = (label: string) => {
				const found = fixture.dom.container.querySelectorAll('[role="menuitem"]').find(row => row.querySelector('.context-menu-item-label')?.textContent === label);
				assert.ok(found, label); return found;
			};
			try {
				await fixture.render(React.createElement(Menu, { controller, fixture }));
				for (const label of [ENGLISH_COPY.playSelection, ENGLISH_COPY.playCutPreview]) assert.equal(item(label).getAttribute('aria-disabled'), 'false');
				await act(async () => { controller.actions.timeline.clearSelection(); });
				for (const label of [ENGLISH_COPY.playSelection, ENGLISH_COPY.playCutPreview]) assert.equal(item(label).getAttribute('aria-disabled'), 'true');
				assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(admitted));
				assert.deepEqual(controller.getSnapshot().history, history); assert.equal(calls.length, 0);
				await act(async () => { controller.actions.timeline.setSelection(0, 0, { trackIds: ['voice'], clipIds: ['clip'] }); });
			} finally { await fixture.dispose(); }
		}
		const before = structuredClone(controller.project);
		if (action === 'selection') await controller.actions.transport.playSelection();
		else await controller.actions.transport.playCutPreview();
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0], { startFrame: 24_000, endFrame: 72_000, ...(action === 'cut' ? { trackIds: ['voice'] } : {}) });
		assert.deepEqual(controller.project, before, 'audition leaves selection, loop and history document unchanged');
		await controller.actions.project.flush({ forceCurrentSnapshot: true });
		assert.deepEqual(await store.loadProject(project.id), controller.project);
	});
}

for (const action of ['action://playback/play-selection', 'play-cut-preview']) test(`selected clip admission reaches the ${action} shortcut`, () => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 24_000, durationFrames: 48_000, sourceDurationFrames: 48_000 });
	const project = createSoundscaperProject({ sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'voice', clipIds: [clip.id] })],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['voice'], clipIds: [clip.id] } });
	assert.equal(evaluateAudacityActionEnablement(action, { snapshot: { project } }), true);
	const empty = createSoundscaperProject({ ...project, selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: [] } });
	assert.equal(evaluateAudacityActionEnablement(action, { snapshot: { project: empty } }), false);
	if (action === 'play-cut-preview') assert.equal(evaluateAudacityActionEnablement(action, { snapshot: { project, recording: true } }), false);
});
