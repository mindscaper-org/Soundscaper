/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { openFramescaperCaptionSidecarFile, saveFramescaperCaptionSidecarFile }
	from '../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import { importFramescaperCaptionSidecar, exportFramescaperCaptionSidecar }
	from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import { normalizeVideoCaptionTrackV1 } from '../src/common/editor/video-caption-track-v27.ts';

for (const origin of ['0.0000001', '0.00000000000000000001', `0.${'0'.repeat(323)}5`, '0', '0.000001']) {
	test(`caption File import and Save keeps the legal decimal percentage ${origin.length > 30 ? 'smallest positive double' : origin}`, async () => {
		const initial = createFramescaperProject(PROFILE, { id: 'decimal-captions' });
		const opened = await openFramescaperCaptionSidecarFile({ file: new File([sidecar(origin)], 'original.ttml') });
		assert.ok(opened);
		const input = { project: initial, format: opened.format, text: opened.text, trackId: 'captions',
			sequenceId: initial.primarySequenceId, trackName: 'Captions', language: 'en' };
		const imported = importFramescaperCaptionSidecar(input);
		const project = applyFramescaperProjectCommand(PROFILE, initial, imported.command);
		assert.ok(Array.isArray(project.videoCaptionTracks));
		const original = normalizeVideoCaptionTrackV1(project.videoCaptionTracks[0]);
		const exported = exportFramescaperCaptionSidecar({ project, trackId: original.id, format: 'imsc1.1' });
		const delivered: File[] = [];
		await saveFramescaperCaptionSidecarFile({ fileService: { saveFile(request) {
			delivered.push(new File([request.text], request.suggestedName, { type: request.mimeType }));
		} }, format: exported.format, trackId: original.id, text: exported.text });
		const saved = delivered[0]; assert.ok(saved);
		const reopened = await openFramescaperCaptionSidecarFile({ file: saved }); assert.ok(reopened);
		const restored = importFramescaperCaptionSidecar({ ...input, format: reopened.format, text: reopened.text });
		assert.deepEqual(restored.result.track.regions, original.regions);
		assert.deepEqual(restored.result.track.cues, original.cues);
		assert.match(exported.text, /tts:origin="[0-9.]+% 70%"/u);
	});
}

function sidecar(origin: string): string {
	return '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:space="preserve" ttp:timeBase="media" '
		+ 'ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ `<head><layout><region xml:id="lower" tts:origin="${origin}% 70%" tts:extent="80% 20%" `
		+ 'tts:displayAlign="after"/></layout></head><body><div><p xml:id="cue" region="lower" '
		+ 'begin="0t" end="1000t">Preserve this caption</p></div></body></tt>';
}
