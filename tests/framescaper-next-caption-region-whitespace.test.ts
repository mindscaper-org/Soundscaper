/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { openFramescaperCaptionSidecarFile } from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { exportFramescaperCaptionSidecar, importFramescaperCaptionSidecar } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';

for (const separator of ['  ', '\t \n', '&#9;']) test(`caption file region lengths admit XML linear whitespace ${JSON.stringify(separator)}`, async () => {
	let project = createFramescaperProject(PROFILE, { id: 'region-whitespace' });
	const opened = await openFramescaperCaptionSidecarFile({ file: new File([sidecar(separator)], 'captions.ttml') });
	assert.ok(opened);
	const input = { project, format: opened.format, text: opened.text, trackId: 'captions',
		sequenceId: project.primarySequenceId, trackName: 'Captions', language: 'en' };
	const imported = importFramescaperCaptionSidecar(input);
	project = applyFramescaperProjectCommand(PROFILE, project, imported.command);
	const exported = exportFramescaperCaptionSidecar({ project, trackId: 'captions', format: 'imsc1.1' });
	const reopened = importFramescaperCaptionSidecar({ ...input,
		project: createFramescaperProject(PROFILE, { id: 'reopened-regions' }), text: exported.text });
	assert.deepEqual(reopened.result.track.regions, [{ schemaVersion: 1, id: 'lower', xPercent: 10,
		yPercent: 70, widthPercent: 80, heightPercent: 20, displayAlign: 'after' }]);
	assert.equal(reopened.result.track.cues[0]?.regionId, 'lower');
	assert.equal(reopened.result.track.cues[0]?.text, 'Speech');
});

for (const separator of ['', '\u00a0', ' and ']) test(`caption region still refuses non-LWSP separator ${JSON.stringify(separator)}`, async () => {
	const project = createFramescaperProject(PROFILE, { id: 'invalid-region-whitespace' });
	const opened = await openFramescaperCaptionSidecarFile({ file: new File([sidecar(separator)], 'captions.ttml') });
	assert.ok(opened);
	assert.throws(() => importFramescaperCaptionSidecar({ project, format: opened.format, text: opened.text,
		trackId: 'captions', sequenceId: project.primarySequenceId, trackName: 'Captions', language: 'en' }), /two percentages/u);
});

function sidecar(separator: string): string {
	return '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:id="captions" xml:space="preserve" '
		+ 'ttp:timeBase="media" ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ `<head><layout><region xml:id="lower" tts:origin="10%${separator}70%" tts:extent="80%${separator}20%" `
		+ 'tts:displayAlign="after"/></layout></head><body><div><p xml:id="cue" region="lower" '
		+ 'begin="0t" end="1000t">Speech</p></div></body></tt>';
}
