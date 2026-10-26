/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { importWorkspaceRoutedFiles } from '../src/common/editor/ui/workspace/import-workspace-routed-files.ts';
import { isWorkspaceImportFile, partitionWorkspaceFiles } from '../src/common/editor/ui/workspace/workspace-file-routing.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

const sidecars = [
	['Opening.text', 'text/plain', '0\t0.1\tOpening dialogue\n'],
	['Opening.sub', 'application/x-subrip', '1\n00:00:00,000 --> 00:00:00,100\nOpening dialogue\n'],
	['Opening.captions', 'text/vtt', 'WEBVTT\n\n00:00.000 --> 00:00.100\nOpening dialogue\n'],
] as const;

for (const [name, type, body] of sidecars) test(`File Import recognizes ${name} through its declared ${type}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, copy: COPY, locale: 'en',
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const file = new File([body], name, { type });
	await importWorkspaceRoutedFiles({ controller, files: [file], importOptions: {}, projectBinVisible: false,
		openProjectFile() { assert.fail('sidecar must not open a project'); },
		requestCueImport() { assert.fail('label sidecar must not ask for a CUE destination'); },
	});
	const labels = controller.project?.tracks.flatMap(track => track.type === 'label' ? track.labels : []) ?? [];
	assert.equal(labels.length, 1);
	assert.equal(labels[0]?.title, 'Opening dialogue');
	assert.equal(labels[0]?.startFrame, 0);
	assert.equal(labels[0]?.endFrame, 4_800);
	assert.equal(isWorkspaceImportFile(file), true, 'File Open recognizes the same selected file');
});

test('MIME fallback preserves recognized filename routes and admits a CUE MIME alias', () => {
	const audio = new File([], 'Recording.wav', { type: 'text/plain' });
	const cue = new File([], 'Album.cue', { type: 'text/plain' });
	const project = new File([], 'Session.sscape', { type: 'text/vtt' });
	const caption = new File([], 'Dialogue.vtt', { type: 'application/x-cue' });
	const alias = new File([], 'Album.chapters', { type: 'application/x-cue; charset=utf-8' });
	assert.deepEqual(partitionWorkspaceFiles([audio, cue, project, caption, alias]), {
		projects: [project], media: [audio], labels: [caption], cues: [cue, alias],
	});
	assert.equal(isWorkspaceImportFile(alias), true);
});
