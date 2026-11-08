/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exportProjectEdl } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { readWithReference, referenceItems } from './helpers/interchange-reference.ts';

test('File Export EDL refuses three-digit record hours before opening the save destination', async () => {
	for (const [hours, minutes, seconds] of [[100, 0, 0], [99, 59, 59]] as const) {
		const project = fixture(hours, minutes, seconds, 60);
		let saves = 0;
		await assert.rejects(exportProjectEdl({ getProject: () => project, state: {}, fileService: { saveFile: () => { saves += 1; } } }),
			/CMX3600.*two.digit.*hour.*OTIO.*FCPXML/u);
		assert.equal(saves, 0);
	}
});

test('an admitted two-digit EDL hour origin remains readable by the reference CMX reader', async () => {
	const result = await exportProjectEdl({ getProject: () => fixture(99, 0, 0, 30), state: {}, fileService: { saveFile: () => undefined } });
	assert.ok(result);
	assert.match(result.text, /99:00:00:00 99:00:01:00/u);
	assert.equal(referenceItems(readWithReference(result.text, 'cmx_3600', { rate: 30 }, '.edl')).length, 1);
});

function fixture(hours: number, minutes: number, seconds: number, frames: number) {
	const source = createVideoSource({ id: 'camera', name: 'Camera.webm', storageKey: 'camera.webm', mimeType: 'video/webm',
		contentSha256: 'ab'.repeat(32), sampleFrameCount: 288_000, sourceFrameCount: 180, frameRate: { num: 30, den: 1 }, width: 192, height: 108 });
	return createFramescaperProject(PROFILE, { id: 'hour-origin', sampleRate: 48_000, primarySequenceId: 'main', sources: [source],
		clips: [{ kind: 'video', id: 'picture', sourceId: source.id, sequenceId: 'main', sequenceStartFrame: 0,
			sequenceFrameCount: frames, sourceInFrame: 0, sourceFrameCount: frames }],
		tracks: [{ id: 'picture-track', type: 'video', clipIds: ['picture'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['picture-track'],
			startTimecode: { negative: false, hours, minutes, seconds, frames: 0 } }],
	});
}
