/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MockAudioContext } from './helpers/mock-audio-context.js';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const owner of ['main', 'cut'] as const) test(`MP19 ancillary: a multi-file timeline import preserves Framescaper ${owner} ownership`, async context => {
	const prior = globalThis.AudioContext; globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
	context.after(() => { globalThis.AudioContext = prior; });
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
	} });
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	const project = createFramescaperProject(PROFILE, { id: 'import-sequences',
		tracks: ['main', 'cut'].map(id => createAudioTrack({ id: `${id}-audio`, name: id })),
		sequences: ['main', 'cut'].map(id => ({ id, trackIds: [`${id}-audio`] })), primarySequenceId: 'main' });
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, environment.store);
	assert.ok(archive.blob instanceof Blob);
	await controller.actions.project.openScapeFile(new File([archive.blob], 'Import.fscape'), () => 'copy');
	assert.equal(controller.getSnapshot().readOnly, false);
	const bytes = Uint8Array.from(encodeWav([new Float32Array(80).fill(.25)], { sampleRate: 48_000 }));
	await controller.actions.project.importFiles([new File([bytes], 'First.wav'), new File([bytes], 'Second.wav')], { destination: 'timeline', trackId: `${owner}-audio` });
	const imported: unknown = controller.project; assert.ok(validateFramescaperProject(PROFILE, imported));
	assert.equal(imported.clips.length, 2);
	const sequence = records(imported.sequences).find(sequence => sequence.id === owner); assert.ok(sequence && Array.isArray(sequence.trackIds));
	const sequenceTrackIds = sequence.trackIds; assert.equal(sequenceTrackIds.length, 2);
	const tracks = records(imported.tracks).filter(track => sequenceTrackIds.includes(track.id));
	assert.equal(tracks.flatMap(track => Array.isArray(track.clipIds) ? track.clipIds : []).length, 2);
});
function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
	assert.ok(Array.isArray(value)); return (value as unknown[]).map(value => {
		assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value)); return value as Readonly<Record<string, unknown>>;
	});
}
