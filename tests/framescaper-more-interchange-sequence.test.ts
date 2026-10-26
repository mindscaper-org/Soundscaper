/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exportProjectEdl, exportProjectOtio, exportProjectFcpxml } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

function project() {
	const source = createVideoSource({ id: 'camera', name: 'Camera.mp4', storageKey: 'media/camera.mp4',
		mimeType: 'video/mp4', contentSha256: 'ab'.repeat(32), sampleFrameCount: 144_000,
		sourceFrameCount: 90, frameRate: { num: 30, den: 1 }, width: 320, height: 180 });
	return createFramescaperProject(PROFILE, { id: 'programme', sampleRate: 48_000, sources: [source],
		primarySequenceId: 'main',
		clips: ['main', 'other'].map(id => ({ kind: 'video', id: `${id}-clip`, sourceId: source.id,
			title: `${id}-picture`, sequenceId: id, sequenceStartFrame: 0, sequenceFrameCount: 30,
			sourceInFrame: 0, sourceFrameCount: 30 })),
		// Each sequence owns its track; the export must scope the project before
		// choosing EDL tracks or adding multitrack profile layers.
		tracks: ['main', 'other'].map(id => ({ id: `${id}-track`, type: 'video', name: id, clipIds: [`${id}-clip`] })),
		sequences: ['main', 'other'].map(id => ({ id, name: id, rate: { num: 30, den: 1 }, trackIds: [`${id}-track`] })),
	});
}

test('MI05: interchange menu exports include only the selected sequence track hierarchy', async () => {
	const initial = project();
	for (const exportTimeline of [exportProjectEdl, exportProjectOtio, exportProjectFcpxml]) {
		for (const sequenceId of ['main', 'other']) {
			const result = await exportTimeline({ getProject: () => initial, state: {}, sequenceId,
				fileService: { saveFile: () => ({ cancelled: true }) } });
			assert.ok(result);
			assert.match(result.text, new RegExp(`${sequenceId}-picture`, 'u'));
			assert.doesNotMatch(result.text, new RegExp(`${sequenceId === 'main' ? 'other' : 'main'}-picture`, 'u'));
		}
	}
});
