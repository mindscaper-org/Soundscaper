/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { VideoCaptionInterchangeError } from '../src/common/editor/video-caption-interchange-contract-v27.ts';
import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { exportFramescaperCaptionSidecar, importFramescaperCaptionSidecar } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';

for (const text of ['<b>Literal</b>', '<I>Literal</I>', '<u>Literal</u>', '<b><i>Literal</i></b>']) {
	test(`SRT delivery refuses to reinterpret caption literal text ${text}`, async () => {
		const { project, track } = await caption(text);
		assert.equal(track.cues[0]?.text, text);
		assert.equal(track.cues[0]?.styleId, null);
		assert.throws(() => exportFramescaperCaptionSidecar({ project, trackId: track.id, format: 'srt' }),
			(error: unknown) => error instanceof VideoCaptionInterchangeError && error.code === 'ACTIVE_CONTENT');
	});
}

for (const text of ['Plain caption', 'x < y and y > z', 'Literal &amp; and &#10;', 'First line\nSecond line']) {
	test(`ordinary SRT caption text retains its exact supported semantics: ${text}`, async () => {
		const { project, track, input } = await caption(text);
		const exported = exportFramescaperCaptionSidecar({ project, trackId: track.id, format: 'srt' });
		const reopened = importFramescaperCaptionSidecar({ ...input, format: 'srt', text: exported.text });
		assert.equal(reopened.result.track.cues[0]?.text, text);
		assert.equal(reopened.result.track.cues[0]?.styleId, null);
	});
}

for (const format of ['webvtt', 'imsc1.1'] as const) {
	test(`${format} remains a lossless alternative for literal caption markup`, async () => {
		const text = '<b>Literal</b>';
		const { project, track, input } = await caption(text);
		const exported = exportFramescaperCaptionSidecar({ project, trackId: track.id, format });
		const reopened = importFramescaperCaptionSidecar({ ...input, format, text: exported.text });
		assert.equal(reopened.result.track.cues[0]?.text, text);
		assert.equal(reopened.result.track.cues[0]?.styleId, null);
	});
}

test('legitimate SRT emphasis still imports and exports text with the existing style-omission report', async () => {
	const { project, track, input } = await caption('1\n00:00:00,000 --> 00:00:01,000\n<b>Styled</b>\n', 'srt');
	assert.equal(track.cues[0]?.text, 'Styled');
	assert.equal(track.styles[0]?.fontWeight, 'bold');
	const exported = exportFramescaperCaptionSidecar({ project, trackId: track.id, format: 'srt' });
	assert.ok(exported.losses.some(loss => loss.code === 'style-omitted'));
	assert.equal(importFramescaperCaptionSidecar({ ...input, format: 'srt', text: exported.text }).result.track.cues[0]?.text, 'Styled');
});

async function caption(text: string, format: 'imsc1.1' | 'srt' = 'imsc1.1') {
	const project = createFramescaperProject(PROFILE, { id: 'caption-literal' });
	const xml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xml:id="captions" xml:lang="en" xml:space="preserve" ttp:timeBase="media" '
		+ 'ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ `<body><div><p xml:id="cue" begin="0t" end="1000t">${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p></div></body></tt>`;
	const opened = await openFramescaperCaptionSidecarFile({ file: new File([format === 'srt' ? text : xml],
		format === 'srt' ? 'Caption.srt' : 'Caption.ttml') });
	assert.ok(opened);
	const input = { project, format: opened.format, text: opened.text, trackId: 'captions',
		sequenceId: project.primarySequenceId, trackName: 'Captions', language: 'en' };
	const imported = importFramescaperCaptionSidecar(input);
	return { project: applyFramescaperProjectCommand(PROFILE, project, imported.command), track: imported.result.track, input };
}
