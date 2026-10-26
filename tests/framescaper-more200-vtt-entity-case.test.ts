/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { normalizeVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';
import { exportFramescaperCaptionSidecar, importFramescaperCaptionSidecar } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';

// WebVTT's tokenizer uses the case-sensitive HTML named-reference table.
// https://www.w3.org/TR/webvtt1/#webvtt-cue-text-tokenizer
// https://html.spec.whatwg.org/multipage/named-characters.html
for (const [payload, expected] of [
	['&NBSP; &NbSp; &LRM; &RLM;', '&NBSP; &NbSp; &LRM; &RLM;'],
	['&AmP; &Lt; &gT; &APOS; &QuOt;', '&AmP; &Lt; &gT; &APOS; &QuOt;'],
	['&AMP; &LT; &GT; &QUOT;', '& < > "'],
	['&nbsp; &lrm; &rlm; &amp; &apos; &quot;', '\u00a0 \u200e \u200f & \' "'],
	['&amp;NBSP; &amp;LRM; &amp;amp;', '&NBSP; &LRM; &amp;'],
] as const) test(`Caption File import preserves case-sensitive reference text: ${payload}`, async () => {
	const initial = createFramescaperProject(PROFILE, { id: 'entity-case' });
	const opened = await openFramescaperCaptionSidecarFile({ file: new File([
		`WEBVTT\n\nspoken\n00:00:00.000 --> 00:00:01.000\n${payload}\n`,
	], 'Dialogue.vtt') }); assert.ok(opened);
	const input = { project: initial, ...opened, trackId: 'captions', sequenceId: initial.primarySequenceId,
		trackName: 'Dialogue', language: 'en' };
	const imported = importFramescaperCaptionSidecar(input);
	const project = applyFramescaperProjectCommand(PROFILE, initial, imported.command);
	assert.ok(Array.isArray(project.videoCaptionTracks));
	const track = normalizeVideoCaptionTrackV1(project.videoCaptionTracks[0]);
	assert.equal(track.cues[0]?.text, expected);
	const exported = exportFramescaperCaptionSidecar({ project, trackId: track.id, format: 'webvtt' });
	const reopened = importFramescaperCaptionSidecar({ ...input, text: exported.text });
	assert.equal(reopened.result.track.cues[0]?.text, expected);
});
