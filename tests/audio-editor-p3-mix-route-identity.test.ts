/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const collision of [false, true]) test(`native Mix & Render preserves a peer's custom output ID collision=${String(collision)}`, async context => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 4800, channelCount: 1 });
	const writer = await store.beginSourceWrite(source.storageKey, source);
	await writer.write([new Float32Array(4800).fill(.25)]); await writer.commit();
	const base = createSoundscaperProject({ id: context.name, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] }), createAudioTrack({ id: 'music', name: 'Music' })] });
	const peerId = collision ? 'assignment:track:voice:master' : 'assignment:track:music:master';
	const lane = normalizeAutomationLaneV21({ id: 'music-level', address: { kind: 'edge', edgeId: peerId, parameterId: 'level' },
		timebase: 'absolute-samples', points: [{ id: 'quiet', position: 0, value: .5 }], segments: [] });
	const project = createSoundscaperProject({ ...base, automationLanes: [lane], mixer: { ...base.mixer,
		edges: base.mixer.edges.map(edge => ({ ...edge,
			id: edge.source.kind === 'track' && edge.source.id === 'voice' ? 'original-voice-output'
				: edge.source.kind === 'track' && edge.source.id === 'music' ? peerId : edge.id,
		})) } });
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], engineFactory: createMemoryRenderEngine as unknown as Options['engineFactory'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Routes.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	controller.actions.timeline.selectClip('clip'); const before: unknown = controller.project; assert.ok(validateSoundscaperProject(before));
	const peer = before.mixer.edges.find(edge => edge.id === peerId); assert.ok(peer);
	await controller.actions.track.mixAndRender({ mixDown: true, renderEffects: true, replaceOriginals: true });
	const after: unknown = controller.project; assert.ok(validateSoundscaperProject(after));
	assert.equal(after.clips.length, 1); assert.notEqual(after.clips[0]?.id, 'clip');
	assert.deepEqual(after.mixer.edges.find(edge => edge.id === peerId), peer, 'the other track retains its exact authored route');
	assert.deepEqual(after.automationLanes, before.automationLanes, 'the other route retains its authored gain automation');
	assert.equal(new Set(after.mixer.edges.map(edge => edge.id)).size, after.mixer.edges.length);
	const output = after.mixer.edges.find(edge => edge.source.kind === 'track' && edge.source.id === 'voice'); assert.ok(output);
	assert.notEqual(output.id, peerId);
	const rendered = after.sources.find(item => item.id === after.clips[0]?.sourceId); assert.ok(rendered);
	assert.equal((await store.getSourceMetadata(rendered.storageKey))?.frameCount, 4800);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before.clips);
	assert.deepEqual(controller.project?.mixer, before.mixer);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.mixer, after.mixer);
});
