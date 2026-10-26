/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { createMixRenderSnapshot } from '../src/common/editor/controller/track-audio/mix-render-model.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import type { ControllerProject, ControllerTrack } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { mixDetectorProject } from './helpers/next-mix-detector-project.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createMemoryRenderEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const kind of ['track', 'bus'] as const) for (const mixDown of [true, false]) test(`NP045: public ${mixDown ? 'combined' : 'individual'} print retains its ${kind} Gate detector`, async context => {
	const { project, sources, channels } = mixDetectorProject(kind);
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	for (const source of sources) {
		const writer = await store.beginSourceWrite(source.storageKey, source); const data = channels.get(source.id); assert.ok(data);
		await writer.write(data); await writer.commit();
	}
	const captured: unknown[] = [];
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store, scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
		engineFactory: (() => {
			const engine = createMemoryRenderEngine(); const load = engine.loadProject.bind(engine);
			engine.loadProject = (project: unknown) => { captured.push(project); load(project); };
			return engine;
		}) as unknown as Options['engineFactory'],
	});
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Detector.sscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false); controller.actions.timeline.selectClip('voice-clip');
	const before = controller.project;
	await controller.actions.track.mixAndRender({ mixDown, renderEffects: true, replaceOriginals: true });
	const snapshot = captured.at(-1); assert.ok(record(snapshot)); assert.ok(Array.isArray(snapshot.tracks));
	assert.deepEqual(snapshot.tracks.map((track: unknown) => { assert.ok(record(track)); return track.id; }), ['voice', 'control']);
	const mixer = snapshot.mixer; assert.ok(record(mixer)); assert.ok(Array.isArray(mixer.edges));
	assert.ok(mixer.edges.some((edge: unknown) => record(edge) && edge.id === 'detector'));
	assert.equal(mixer.edges.some((edge: unknown) => record(edge) && edge.id === 'relay-input'), kind === 'bus');
	assert.equal(mixer.edges.some((edge: unknown) => record(edge) && edge.id === 'relay-output'), false, 'detector buses never feed the printed programme');
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.clips, before?.clips);
});

test('NP045: dry and disabled processors do not acquire unnecessary detector media', () => {
	for (const [enabled, renderEffects] of [[false, true], [true, false]] as const) {
		const { project } = mixDetectorProject('bus', enabled); const voice = project.tracks[0]; assert.ok(voice);
		const snapshot = createMixRenderSnapshot(project as unknown as ControllerProject, [voice as unknown as ControllerTrack], { mixDown: true, renderEffects });
		assert.deepEqual(snapshot.tracks.map(track => track.id), ['voice']);
	}
});

test('NP045: synthetic detector anchors cannot adopt authored programme edge automation', () => {
	const { project } = mixDetectorProject(); const voice = project.tracks[0]; assert.ok(voice);
	const lane = normalizeAutomationLaneV21({ id: 'control-output', address: { kind: 'edge', edgeId: 'assignment:track:control:master', parameterId: 'level' },
		timebase: 'absolute-samples', points: [{ id: 'open', position: 0, value: 1 }], segments: [] });
	const original = { ...project, automationLanes: [lane] };
	for (const mixDown of [false, true]) {
		const snapshot = createMixRenderSnapshot(original as unknown as ControllerProject, [voice as unknown as ControllerTrack], { mixDown, renderEffects: true });
		assert.deepEqual(snapshot.automationLanes, [], 'the silent output anchor stays silent while actual detector routes remain authored');
	}
});

function record(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
