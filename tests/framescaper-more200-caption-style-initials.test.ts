/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { normalizeVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';
import { exportFramescaperCaptionSidecar, importFramescaperCaptionSidecar } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';

for (const explicit of [false, true]) test(`IMSC initial style values survive actual sidecar import and export; explicit=${explicit}`, async () => {
	const initial = createFramescaperProject(PROFILE, { id: 'caption-initials' });
	const text = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:space="preserve" xml:lang="en" ttp:timeBase="media" '
		+ 'ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text">'
		+ `<head><styling><style xml:id="spoken" tts:fontSize="75%"${explicit ? ' tts:backgroundColor="#000000cc" tts:textAlign="center"' : ''}/></styling></head>`
		+ '<body><div><p xml:id="cue" style="spoken" begin="00:00:00" end="00:00:01">Dialogue</p></div></body></tt>';
	const opened = await openFramescaperCaptionSidecarFile({ file: new File([text], 'dialogue.ttml') });
	assert.ok(opened);
	const imported = importFramescaperCaptionSidecar({ project: initial, ...opened, trackId: 'captions',
		sequenceId: initial.primarySequenceId, trackName: 'Captions', language: 'en' });
	const project = applyFramescaperProjectCommand(PROFILE, initial, imported.command);
	assert.ok(Array.isArray(project.videoCaptionTracks));
	const style = normalizeVideoCaptionTrackV1(project.videoCaptionTracks[0]).styles[0]; assert.ok(style);
	assert.equal(style.backgroundColor, explicit ? '#000000cc' : '#00000000');
	assert.equal(style.textAlign, explicit ? 'center' : 'start');
	assert.equal(style.fontSizePercent, 5);
	const exported = exportFramescaperCaptionSidecar({ project, trackId: 'captions', format: 'imsc1.1' });
	assert.ok(exported.text.includes(`tts:backgroundColor="${style.backgroundColor}"`));
	assert.ok(exported.text.includes(`tts:textAlign="${style.textAlign}"`));
});
