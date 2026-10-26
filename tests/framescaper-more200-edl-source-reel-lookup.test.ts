/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exportProjectEdl } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';

for (const sourceId of ['toString', 'constructor', 'normal-camera']) {
	for (const explicit of [false, true]) test(`the EDL menu action ${explicit ? 'uses an own override' : 'retains the real reel'} for source ${sourceId}`, async () => {
		const project = createFramescaperProject(PROFILE, { id: 'source-reels', sampleRate: 48_000,
			primarySequenceId: 'main', sources: [createVideoSource({ id: sourceId, name: 'CAMERA',
				storageKey: 'media/camera.webm', mimeType: 'video/webm', contentSha256: 'ab'.repeat(32),
				sampleFrameCount: 48_000, sourceFrameCount: 30, frameRate: { num: 30, den: 1 }, width: 160, height: 90 })],
			clips: [{ kind: 'video', id: 'picture', sourceId, sequenceId: 'main', sequenceStartFrame: 0,
			sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 }],
			tracks: [{ id: 'picture-track', type: 'video', clipIds: ['picture'] }],
			sequences: [{ id: 'main', name: 'Programme', rate: { num: 30, den: 1 }, trackIds: ['picture-track'] }] });
		let saved: Blob | null = null;
		const result = await exportProjectEdl({ getProject: () => project, state: {},
			...(explicit ? { reelNames: Object.fromEntries([[sourceId, 'TAPE01']]) } : {}),
			fileService: { saveFile: request => { assert.ok(request.blob instanceof Blob); saved = request.blob; return { cancelled: true }; } } });
		assert.ok(result && saved);
		assert.equal(result.text.split('\n').find(line => /^001\s/u.test(line))?.trim().split(/\s+/u)[1],
			explicit ? 'TAPE01' : 'CAMERA', 'only an own supplied reel overrides the actual source name');
	});
}
