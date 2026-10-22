/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { exportFramescaperCaptionSidecar, importFramescaperCaptionSidecar } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import { importVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';

for (const language of ['x-studio', 'I-klingon', 'i-default']) test(`caption file import/export preserves valid BCP47 language ${language}`, async () => {
	let project = createFramescaperProject(PROFILE, { id: 'caption-languages' });
	const text = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ `xml:id="studio" xml:lang="${language}" xml:space="preserve" ttp:timeBase="media" `
		+ 'ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ '<body><div><p xml:id="cue" begin="0t" end="1000t">Speech</p></div></body></tt>';
	const opened = await openFramescaperCaptionSidecarFile({ file: new File([text], 'studio.ttml') });
	assert.ok(opened);
	const imported = importFramescaperCaptionSidecar({ project, format: opened.format, text: opened.text,
		trackId: 'caption-track', sequenceId: project.primarySequenceId, trackName: 'Captions', language: 'und' });
	project = applyFramescaperProjectCommand(PROFILE, project, imported.command);
	const exported = exportFramescaperCaptionSidecar({ project, trackId: 'studio', format: 'imsc1.1' });
	assert.match(exported.text, new RegExp(`xml:lang="${language}"`, 'u'));
});

for (const language of ['x', 'x-', 'x-123456789', 'i-madeup']) test(`caption language still refuses malformed special tag ${language}`, () => {
	assert.throws(() => importVideoCaptionTrackV1('1\n00:00:00,000 --> 00:00:01,000\nSpeech\n', {
		format: 'srt', sampleRate: 48_000, trackId: 'track', sequenceId: 'main-sequence', trackName: 'Captions', language,
	}), /BCP 47/u);
});
