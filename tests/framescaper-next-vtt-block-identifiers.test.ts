/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { importFramescaperCaptionSidecar } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import { parseAudioEditorLabels } from '../src/common/editor/label-io.js';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { normalizeVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const identifiers of [['STYLE introduction', 'REGION A'], ['REGION\tA', 'STYLE\tintroduction']]) {
	const text = `WEBVTT\n\n${identifiers[0]}\n00:00:00.000 --> 00:00:01.000\nOpening dialogue\n\n${identifiers[1]}\n00:00:01.000 --> 00:00:02.000\nClosing dialogue\n`;
	test(`Caption Tracks imports cue identifiers ${identifiers.join(' / ')}`, async () => {
		const initial = createFramescaperProject(PROFILE, { id: 'vtt-identifiers' });
		const file = await openFramescaperCaptionSidecarFile({ file: new File([text], 'Dialogue.vtt') }); assert.ok(file);
		const imported = importFramescaperCaptionSidecar({ project: initial, format: file.format, text: file.text,
			trackId: 'captions', sequenceId: initial.primarySequenceId, trackName: 'Dialogue', language: 'en' });
		const project = applyFramescaperProjectCommand(PROFILE, initial, imported.command);
		assert.ok(Array.isArray(project.videoCaptionTracks));
		const track = normalizeVideoCaptionTrackV1(project.videoCaptionTracks[0]);
		assert.deepEqual(track.cues.map(cue => [cue.text, cue.startFrame, cue.endFrame]), [
			['Opening dialogue', 0, 48_000], ['Closing dialogue', 48_000, 96_000],
		]);
	});
	test(`File Open imports labels named by ${identifiers.join(' / ')}`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		await controller.actions.labels.importFile(new File([text], 'Dialogue.vtt', { type: 'text/vtt' }));
		const track = controller.project?.tracks.find(track => track.type === 'label'); assert.ok(track);
		assert.deepEqual(track.labels?.map(label => [label.title, label.startFrame, label.endFrame]), [
			['Opening dialogue', 0, 48_000], ['Closing dialogue', 48_000, 96_000],
		]);
		controller.actions.edit.undo(); assert.ok(!controller.project?.tracks.some(value => value.id === track.id));
		controller.actions.edit.redo(); assert.deepEqual(controller.project?.tracks.find(value => value.id === track.id), track);
	});
}

for (const marker of ['STYLE', 'REGION', 'STYLE \t', 'REGION\t ']) test(`actual ${JSON.stringify(marker)} metadata remains outside the styled subset`, () => {
	const text = `WEBVTT\n\n${marker}\n${marker.startsWith('STYLE') ? '::cue { color: red }' : 'id:region width:50%'}\n\n1\n00:00:00.000 --> 00:00:01.000\nDialogue\n`;
	const project = createFramescaperProject(PROFILE, { id: 'vtt-metadata' });
	assert.throws(() => importFramescaperCaptionSidecar({ project, format: 'webvtt', text,
		trackId: 'captions', sequenceId: project.primarySequenceId, trackName: 'Dialogue', language: 'en' }), /styling blocks/u);
	assert.deepEqual(parseAudioEditorLabels(text, { format: 'vtt' }).labels.map(label => label.title), ['Dialogue']);
});

test('NOTE with following annotation is still a comment in both importers', () => {
	const text = 'WEBVTT\n\nNOTE production note\n00:00:00.000 --> 00:00:01.000\nIgnore this\n\n1\n00:00:01.000 --> 00:00:02.000\nDialogue\n';
	assert.deepEqual(parseAudioEditorLabels(text, { format: 'vtt' }).labels.map(label => label.title), ['Dialogue']);
	const project = createFramescaperProject(PROFILE, { id: 'vtt-comment' });
	const result = importFramescaperCaptionSidecar({ project, format: 'webvtt', text,
		trackId: 'captions', sequenceId: project.primarySequenceId, trackName: 'Dialogue', language: 'en' });
	assert.deepEqual(result.result.track.cues.map(cue => cue.text), ['Dialogue']);
});
