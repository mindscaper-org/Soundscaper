/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const operation of ['split', 'merge', 'remove'] as const) for (const spare of operation === 'remove' ? [false] : [false, true]) {
	test(`NP044: ${operation} preserves only surviving folder processing; spare=${spare}`, async context => {
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const source = createAudioSource({ id: 'tone', frameCount: 4_800, channelCount: operation === 'merge' ? 1 : 2, sampleRate: 48_000 });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write(Array.from({ length: source.channelCount }, () => new Float32Array(source.frameCount).fill(.25))); await writer.commit();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
			engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		const ids = operation === 'merge' ? ['voice', 'partner'] : ['voice'];
		const project = createSoundscaperProject({ id: `folder-bus-${operation}-${spare}`, sources: [source],
			tracks: ids.map(id => createAudioTrack({ id, clipIds: [`${id}-clip`] })),
			clips: ids.map(id => createAudioClip({ id: `${id}-clip`, sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })),
		});
		const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
		await controller.actions.project.openScapeFile(new File([archive.blob], 'Folder.sscape'), () => 'copy');
		assert.equal(controller.getSnapshot().readOnly, false);
		if (spare) { const added = controller.actions.track.add({ id: 'spare', name: 'Empty sibling' }); assert.equal(added, 'spare'); }
		const folder = controller.actions.trackFolders.wrapSelection([...ids, ...(spare ? ['spare'] : [])], 'Mix'); assert.ok(folder);
		controller.actions.mixer.updateBus('group', folder, { gain: .5, pan: .25, collapsed: false });
		const effect = controller.actions.effects.add({ scope: 'group', busId: folder, type: 'lowpass' }); assert.equal(typeof effect, 'string');
		if (typeof effect !== 'string') throw new Error('The folder must have its authored filter.');
		const send = controller.actions.mixer.addBus('send'); assert.equal(typeof send, 'string');
		if (typeof send !== 'string') throw new Error('The folder must have its authored send.');
		const lane = normalizeAutomationLaneV21({ id: 'folder-ride', address: { kind: 'strip', strip: { kind: 'mixer-node', id: folder }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'head', position: 0, value: .5 }], segments: [] });
		controller.actions.edit.commit({ type: 'automation-lane/set', laneId: lane.id, expected: null, lane });
		const initial: unknown = controller.project; assert.ok(validateSoundscaperProject(initial));
		const outgoing = initial.mixer.edges.find(edge => edge.source.kind === 'mixer-node' && edge.source.id === folder); assert.ok(outgoing);
		controller.actions.edit.commit({ type: 'mixer-graph/set', expected: initial.mixer, mixer: { ...initial.mixer,
			edges: [...initial.mixer.edges.map(edge => edge.id === outgoing.id ? { ...edge, level: .75 } : edge),
				{ id: 'folder-send', kind: 'send', source: { kind: 'mixer-node', id: folder }, destination: { kind: 'mixer-node', id: send }, position: 'post-fader', level: .7, enabled: true, channelMap: [] }],
			vcas: [{ id: 'folder-vca', name: 'Folder VCA', gain: .8, mute: false, members: [{ kind: 'mixer-node', id: folder }] }],
		} });
		for (const extra of [
			normalizeAutomationLaneV21({ ...lane, id: 'folder-send-ride', address: { kind: 'edge', edgeId: 'folder-send', parameterId: 'level' } }),
			normalizeAutomationLaneV21({ ...lane, id: 'folder-filter-ride', address: { kind: 'effect', strip: { kind: 'mixer-node', id: folder }, effectId: effect, parameterId: 'frequency' }, points: [{ id: 'cutoff', position: 0, value: 1_000 }] }),
		]) controller.actions.edit.commit({ type: 'automation-lane/set', laneId: extra.id, expected: null, lane: extra });
		const before: unknown = controller.project; assert.ok(validateSoundscaperProject(before));
		if (operation === 'split') await controller.actions.track.splitStereoLR('voice');
		else if (operation === 'merge') await controller.actions.track.makeStereo('voice', 'partner');
		else controller.actions.track.remove('voice');
		const after: unknown = controller.project; assert.ok(validateSoundscaperProject(after));
		if (operation === 'remove') {
			assert.equal(after.mixer.groups.some(bus => bus.id === folder), false);
			assert.equal(after.automationLanes.some(value => value.id === lane.id), false);
		} else {
			assert.deepEqual(structuredClone(after.mixer.groups.find(bus => bus.id === folder)), structuredClone(before.mixer.groups.find(bus => bus.id === folder)));
			assert.deepEqual(after.automationLanes, before.automationLanes);
			assert.deepEqual(after.mixer.edges.find(edge => edge.id === outgoing.id), before.mixer.edges.find(edge => edge.id === outgoing.id));
			assert.deepEqual(after.mixer.vcas, before.mixer.vcas);
			assert.deepEqual(after.mixer.edges.find(edge => edge.id === 'folder-send'), before.mixer.edges.find(edge => edge.id === 'folder-send'));
		}
		controller.actions.edit.undo(); assert.deepEqual(structuredClone(controller.project?.mixer), structuredClone(before.mixer)); assert.deepEqual(controller.project?.automationLanes, before.automationLanes);
		controller.actions.edit.redo(); assert.deepEqual(structuredClone(controller.project?.mixer), structuredClone(after.mixer)); assert.deepEqual(controller.project?.automationLanes, after.automationLanes);
	});
}
