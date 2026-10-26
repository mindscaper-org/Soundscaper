/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const payload of ['<b>Hello & welcome</b>', '<I><U>Hello\nworld</U></I>', '2 < 3 &amp; stays literal']) {
	test(`SRT label import projects the displayed cue text: ${payload}`, async context => {
		type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
		const runtime = createSoundscaperProjectRuntimeSelection();
		const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await controller.dispose(); }); await controller.ready;
		const text = `1\n00:00:01,000 --> 00:00:02,000\n${payload}\n`;
		const reference = importVideoCaptionTrackV1(text, { format: 'srt', sampleRate: 48_000,
			trackId: 'reference', trackName: 'Reference', sequenceId: 'main', language: 'en' });
		await controller.actions.labels.importFile(new File([text], 'Styled.srt', { type: 'application/x-subrip' }));
		const track = controller.project?.tracks.find(candidate => candidate.type === 'label'); assert.ok(track);
		assert.equal(track.labels?.[0]?.title, reference.track.cues[0]?.text);
		assert.equal(track.labels?.[0]?.startFrame, 48_000);
		assert.equal(track.labels?.[0]?.endFrame, 96_000);
		controller.actions.edit.undo(); assert.ok(!controller.project?.tracks.some(candidate => candidate.id === track.id));
		controller.actions.edit.redo();
		const restored = controller.project?.tracks.find(candidate => candidate.id === track.id);
		assert.ok(restored?.type === 'label');
		assert.equal(restored.labels?.[0]?.title, reference.track.cues[0]?.text);
	});
}
