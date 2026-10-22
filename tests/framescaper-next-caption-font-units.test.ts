/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { exportFramescaperCaptionSidecar, importFramescaperCaptionSidecar } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';

for (const [font, expected] of [['75%', 5], ['97.5%', 6.5], ['7.5%', .5], ['300%', 20], [null, 100 / 15]] as const) {
	test(`File import resolves IMSC ${font ?? 'initial'} font size on its default fifteen-row cell grid`, async () => {
		const initial = createFramescaperProject(PROFILE, { id: 'font-units' });
		const opened = await openFramescaperCaptionSidecarFile({ file: new File([sidecar(font)], 'dialogue.ttml') });
		assert.ok(opened);
		const imported = importFramescaperCaptionSidecar({ project: initial, format: opened.format, text: opened.text,
			trackId: 'captions', sequenceId: initial.primarySequenceId, trackName: 'Captions', language: 'en' });
		const project = applyFramescaperProjectCommand(PROFILE, initial, imported.command);
		assert.equal(project.videoCaptionTracks[0]?.styles[0]?.fontSizePercent, expected);
		assert.equal(project.videoCaptionTracks[0]?.cues[0]?.text, 'Readable caption');
		const exported = exportFramescaperCaptionSidecar({ project, trackId: 'captions', format: 'imsc1.1' });
		assert.match(exported.text, new RegExp(`tts:fontSize="${font ?? '100%'}"`, 'u'));
	});
}

test('menu-imported SRT emphasis exports the native font size in IMSC parent-font units', async () => {
	const initial = createFramescaperProject(PROFILE, { id: 'font-export' });
	const opened = await openFramescaperCaptionSidecarFile({ file: new File([
		'1\n00:00:00,000 --> 00:00:01,000\n<b>Readable caption</b>\n',
	], 'dialogue.srt') });
	assert.ok(opened);
	const input = { project: initial, format: opened.format, text: opened.text, trackId: 'captions',
		sequenceId: initial.primarySequenceId, trackName: 'Captions', language: 'en' };
	const imported = importFramescaperCaptionSidecar(input);
	const project = applyFramescaperProjectCommand(PROFILE, initial, imported.command);
	const exported = exportFramescaperCaptionSidecar({ project, trackId: 'captions', format: 'imsc1.1' });
	// TTML1 §8.2.9: percentages resolve against the inherited 1c font, at 15 cells per root height.
	assert.match(exported.text, /tts:fontSize="75%"/u);
	const reopened = importFramescaperCaptionSidecar({ ...input, project: initial, format: 'imsc1.1', text: exported.text });
	assert.deepEqual(reopened.result.track.styles, imported.result.track.styles);
});

function sidecar(font: string | null): string {
	return '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:space="preserve" ttp:timeBase="media" '
		+ 'ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ `<head><styling><style xml:id="spoken"${font === null ? '' : ` tts:fontSize="${font}"`}/></styling></head>`
		+ '<body><div><p xml:id="cue" style="spoken" begin="0t" end="1000t">Readable caption</p></div></body></tt>';
}
