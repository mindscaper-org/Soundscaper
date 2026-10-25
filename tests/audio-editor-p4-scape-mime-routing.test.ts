/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { isScapeProjectFile } from '../src/common/editor/scape-project-format.ts';
import { exportScapeProject } from '../src/common/editor/scape-project.js';
import { openWorkspaceProjectFile } from '../src/common/editor/ui/workspace/open-workspace-project-file.ts';
import { partitionWorkspaceFiles, WORKSPACE_PROJECT_FILE_ACCEPT, WORKSPACE_IMPORT_FILE_ACCEPT } from '../src/common/editor/ui/workspace/workspace-file-routing.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
const MIME = 'application/vnd.soundscaper.scape+zip';

for (const [name, type, throughWorkspace] of [
	['Session', MIME, true], ['Session', `${MIME}; charset=binary`, false], ['Session.sscape', '', true],
	['Session.backup', MIME, true], ['Session.backup', MIME, false],
] as const) test(`native File Open accepts ${name}/${type || 'unknown MIME'} (${throughWorkspace ? 'workspace' : 'native service'})`, async context => {
	const source = createAudioSource({ id: 'voice', name: 'Voice.wav', sampleRate: 48_000, channelCount: 1, frameCount: 480 });
	const project = createSoundscaperProject({ id: 'mime-project', title: 'MIME project', sources: [source],
		clips: [createAudioClip({ id: 'clip', title: 'Voice', sourceId: source.id, durationFrames: 480, sourceDurationFrames: 480 })],
		tracks: [createAudioTrack({ id: 'track', name: 'Voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const pcm = Float32Array.from({ length: 480 }, (_, frame) => (frame % 19 - 9) / 16);
	const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([pcm]); await writer.commit();
	const archive = await exportScapeProject(project, store); assert.ok(archive.blob instanceof Blob);
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const file = new File([archive.blob], name, { type });
	const open = (input: File) => controller.actions.project.openScapeFile(input, () => 'copy');
	if (throughWorkspace) await openWorkspaceProjectFile(controller, file, open); else await open(file);
	const opened: unknown = controller.project; assert.ok(validateSoundscaperProject(opened));
	assert.equal(opened.title, project.title); assert.equal(opened.clips.length, 1);
	const imported = opened.sources[0]; assert.ok(imported); assert.equal(imported.kind, 'audio');
	const chunk = await store.readSourceChunk(imported.storageKey, 0); assert.ok(chunk);
	assertPcmSamplesEqual(chunk.channels[0], pcm); await controller.actions.project.flush();
	const saved: unknown = await store.loadProject(opened.id); assert.ok(validateSoundscaperProject(saved));
	assert.deepEqual(saved.clips, opened.clips); assert.deepEqual(saved.sources, opened.sources);
});

test('batch classification honors the advertised native MIME only without a conflicting suffix', () => {
	assert.ok(WORKSPACE_PROJECT_FILE_ACCEPT.split(',').includes(MIME));
	const project = new File(['archive'], 'Session', { type: MIME.toUpperCase() });
	const backup = new File(['archive'], 'Session.backup', { type: `${MIME}; charset=binary` });
	const audio = new File(['audio'], 'take.wav', { type: MIME });
	const labels = new File(['labels'], 'markers.txt', { type: MIME });
	const disguised = new File(['archive'], 'Session.sscape.zip', { type: MIME });
	const generic = new File(['archive'], 'Session', { type: 'application/zip' });
	assert.deepEqual(partitionWorkspaceFiles([project, backup, audio, labels, disguised, generic]), {
		projects: [project, backup], media: [audio, disguised, generic], labels: [labels], cues: [],
	});
});

test('a native MIME declaration never bypasses actual archive validation or creates a media project', async () => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engine: createMemoryEngine() as unknown as Options['engine'] });
	await controller.ready;
	try {
		const before: unknown = controller.project;
		await assert.rejects(openWorkspaceProjectFile(controller, new File(['not a ZIP'], 'Session', { type: MIME }),
			file => controller.actions.project.openScapeFile(file, () => 'copy')), /(?:Scape|ZIP|archive)/iu);
		assert.equal(controller.project, before); assert.equal(controller.getSnapshot().importing, false);
	} finally { await controller.dispose(); }
});


test('native MIME fallback preserves every explicit workspace import suffix', () => {
	const suffixes = [...WORKSPACE_IMPORT_FILE_ACCEPT.split(',').filter(value => value.startsWith('.')),
		'.aup', '.aup3', '.aup4', '.dawproject', '.sesx', '.au', '.snd', '.auf', '.zip', '.sscape.zip'];
	for (const suffix of suffixes) assert.equal(isScapeProjectFile(new File(['archive'], `Session${suffix}`, { type: MIME })), false, suffix);
	assert.equal(isScapeProjectFile(new File(['archive'], 'Session.backup', { type: 'application/zip' })), false);
});
