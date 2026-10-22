/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { exportFramescaperCaptionSidecar, importFramescaperCaptionSidecar } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';

for (const field of ['region', 'style'] as const) test(`TTML ${field} percentages accept the declared number grammar`, async () => {
	const initial = createFramescaperProject(PROFILE, { id: `percent-${field}` });
	const opened = await openFramescaperCaptionSidecarFile({ file: new File([sidecar(field)], 'captions.ttml') });
	assert.ok(opened);
	const input = { project: initial, format: opened.format, text: opened.text, trackId: 'captions',
		sequenceId: initial.primarySequenceId, trackName: 'Captions', language: 'en' };
	const imported = importFramescaperCaptionSidecar(input);
	const project = applyFramescaperProjectCommand(PROFILE, initial, imported.command);
	const exported = exportFramescaperCaptionSidecar({ project, trackId: 'captions', format: 'imsc1.1' });
	const reopened = importFramescaperCaptionSidecar({ ...input,
		project: createFramescaperProject(PROFILE, { id: `reopened-${field}` }), text: exported.text });
	assert.deepEqual(reopened.result.track.regions, imported.result.track.regions);
	assert.deepEqual(reopened.result.track.styles, imported.result.track.styles);
	assert.equal(reopened.result.track.regions[0]?.xPercent, field === 'region' ? .5 : 10);
	assert.equal(reopened.result.track.styles[0]?.fontSizePercent, field === 'style' ? .5 : 5);
	assert.equal(reopened.result.track.cues[0]?.text, 'Speech');
});

for (const token of ['.%', '5.%', '1e1%', '++5%', 'NaN%', 'Infinity%']) test(`TTML percentage grammar refuses ${token}`, async () => {
	const project = createFramescaperProject(PROFILE, { id: 'invalid-percent' });
	const opened = await openFramescaperCaptionSidecarFile({ file: new File([sidecar('style').replace('+.5%', token)], 'captions.ttml') });
	assert.ok(opened);
	assert.throws(() => importFramescaperCaptionSidecar({ project, format: opened.format, text: opened.text,
		trackId: 'captions', sequenceId: project.primarySequenceId, trackName: 'Captions', language: 'en' }), /must be a percentage/u);
});

function sidecar(field: 'region' | 'style'): string {
	return '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:id="captions" xml:space="preserve" '
		+ 'ttp:timeBase="media" ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ `<head><styling><style xml:id="spoken" tts:fontSize="${field === 'style' ? '+.5%' : '5%'}"/></styling>`
		+ `<layout><region xml:id="lower" tts:origin="${field === 'region' ? '.5% +70%' : '10% 70%'}" `
		+ `tts:extent="${field === 'region' ? '+99% 20%' : '80% 20%'}" tts:displayAlign="after"/></layout></head>`
		+ '<body><div><p xml:id="cue" style="spoken" region="lower" begin="0t" end="1000t">Speech</p></div></body></tt>';
}
