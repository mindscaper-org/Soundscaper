/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { exportFramescaperCaptionSidecar, importFramescaperCaptionSidecar } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import { normalizeVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

for (const separator of [' ', '\t']) for (const emphasized of [false, true]) {
	test(`Caption Tracks imports a ${JSON.stringify(separator)}-separated voice annotation; emphasis=${emphasized}`, async () => {
		const initial = createFramescaperProject(PROFILE, { id: 'voice-separator' });
		const body = emphasized ? `<b><v${separator}Alex>Hello</v></b>` : `<v${separator}Alex>Hello`;
		const file = await openFramescaperCaptionSidecarFile({ file: new File([
			`WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n${body}\n`,
		], 'Dialogue.vtt') }); assert.ok(file);
		const input = { project: initial, format: file.format, text: file.text, trackId: 'captions',
			sequenceId: initial.primarySequenceId, trackName: 'Dialogue', language: 'en' };
		const imported = importFramescaperCaptionSidecar(input);
		const project = applyFramescaperProjectCommand(PROFILE, initial, imported.command);
		assert.ok(Array.isArray(project.videoCaptionTracks));
		const track = normalizeVideoCaptionTrackV1(project.videoCaptionTracks[0]);
		assert.equal(track.cues[0]?.text, 'Hello'); assert.equal(track.speakers[0]?.name, 'Alex');
		assert.equal(track.cues[0]?.speakerId, track.speakers[0]?.id);
		assert.equal(track.styles[0]?.fontWeight ?? 'normal', emphasized ? 'bold' : 'normal');
		const output = exportFramescaperCaptionSidecar({ project, trackId: track.id, format: 'webvtt' });
		assert.match(output.text, /<v Alex>/u);
		const reopened = importFramescaperCaptionSidecar({ ...input, text: output.text });
		assert.deepEqual(reopened.result.track.cues, track.cues); assert.deepEqual(reopened.result.track.speakers, track.speakers);
	});
}

test('voice annotation payload whitespace is retained after the one grammar separator', async () => {
	const project = createFramescaperProject(PROFILE, { id: 'voice-spacing' });
	const file = await openFramescaperCaptionSidecarFile({ file: new File([
		'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<v\t Alex  Jo >Hello</v>\n',
	], 'Dialogue.vtt') }); assert.ok(file);
	const result = importFramescaperCaptionSidecar({ project, format: file.format, text: file.text, trackId: 'captions',
		sequenceId: project.primarySequenceId, trackName: 'Dialogue', language: 'en' });
	assert.equal(result.result.track.speakers[0]?.name, ' Alex  Jo ');
});
