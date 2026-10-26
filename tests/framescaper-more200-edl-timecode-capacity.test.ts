/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEdlExport } from '../src/common/editor/edl-export.ts';
import { exportProjectEdl } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { readWithReference, referenceItems } from './helpers/interchange-reference.ts';

// CMX manufacturer907567p14 states two digits per timecode field:
// https://xmil.biz/EDL-X/CMX3600.pdf
for (const fps of [50, 60, 120]) {
	test(`File Export EDL ${fps > 100 ? 'refuses three-digit frame labels' : `retains ${fps}fps reader compatibility`}`, async () => {
		const source = createVideoSource({ id: 'camera', name: 'Camera.webm', storageKey: 'camera.webm',
			mimeType: 'video/webm', contentSha256: 'ab'.repeat(32), sampleFrameCount: 288_000,
			sourceFrameCount: 180, frameRate: { num: 30, den: 1 }, width: 192, height: 108 });
		const project = createFramescaperProject(PROFILE, { id: 'high-rate-sequence', sampleRate: 48_000,
			primarySequenceId: 'main', sources: [source],
			clips: [{ kind: 'video', id: 'picture', sourceId: source.id, sequenceId: 'main',
				sequenceStartFrame: 0, sequenceFrameCount: fps, sourceInFrame: 29, sourceFrameCount: 30 }],
			tracks: [{ id: 'pictures', type: 'video', clipIds: ['picture'] }],
			sequences: [{ id: 'main', rate: { num: fps, den: 1 }, trackIds: ['pictures'] }],
		});
		const saved: Blob[] = [], state: { deliveryReport?: unknown } = {};
		const run = exportProjectEdl({ getProject: () => project, state,
			fileService: { saveFile: request => { assert.ok(request.blob instanceof Blob); saved.push(request.blob); } } });
		if (fps > 100) {
			await assert.rejects(run, /CMX3600.*two.digit.*OTIO.*FCPXML/u);
			assert.equal(saved.length, 0); assert.equal(state.deliveryReport, undefined);
		} else {
			const result = await run; assert.ok(result); assert.equal(saved.length, 1);
			assert.equal(await saved[0]!.text(), result.text);
			const clip = referenceItems(readWithReference(result.text, 'cmx_3600', { rate: fps }, '.edl'))[0];
			assert.ok(clip); assert.equal(clip.durationValue, fps); assert.equal(clip.startRate, fps);
		}
		assert.equal(project.sequences[0]?.rate.num, fps);
	});
}

test('the largest two-digit CMX frame field retains its existing serialization', () => {
	const result = createEdlExport({ title: 'Two digits', rate: { num: 100, den: 1 }, events: [{
		reel: 'CAMERA', trackKind: 'V', sourceInFrames: 99, sourceOutFrames: 100,
		recordInFrames: 0, recordOutFrames: 1,
	}] });
	assert.match(result.text, /00:00:00:99 00:00:01:00 00:00:00:00 00:00:00:01/u);
});
