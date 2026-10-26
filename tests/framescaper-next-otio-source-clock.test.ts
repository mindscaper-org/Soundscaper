/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { exportProjectOtio } from '../src/common/editor/controller/export/interchange-export-action.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { readWithReference, referenceItems } from './helpers/interchange-reference.ts';

// Completes the prior I22 source-clock repair for the independently serialized OTIO profile.
for (const rate of [{ num: 24, den: 1 }, { num: 60, den: 1 }, { num: 30_000, den: 1_001 }]) {
	test(`File Export OTIO preserves source frame1 at ${rate.num}/${rate.den} on a30fps sequence`, async () => {
		const source = createVideoSource({ id: 'camera', name: 'Camera.webm', storageKey: 'camera.webm',
			mimeType: 'video/webm', contentSha256: 'ab'.repeat(32), sampleFrameCount: 300 * 48_000 * rate.den / rate.num,
			sourceFrameCount: 300, frameRate: rate, width: 192, height: 108 });
		const project = createFramescaperProject(PROFILE, { id: 'mixed-source-clock', sampleRate: 48_000,
			primarySequenceId: 'main', sources: [source],
			clips: [{ kind: 'video', id: 'trimmed-camera', sourceId: source.id, sequenceId: 'main',
				sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 1, sourceFrameCount: Math.floor(rate.num / rate.den) }],
			tracks: [{ type: 'video', id: 'pictures', clipIds: ['trimmed-camera'] }],
			sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }],
		});
		const saved: Blob[] = [];
		const result = await exportProjectOtio({ getProject: () => project, state: {},
			fileService: { saveFile: request => { assert.ok(request.blob instanceof Blob); saved.push(request.blob); } } });
		assert.ok(result); assert.equal(saved.length, 1); assert.equal(await saved[0]!.text(), result.text);
		const clip = referenceItems(readWithReference(result.text, 'otio_json', {}, '.otio')).find(item => item.schema === 'Clip');
		assert.ok(clip);
		const sourceSeconds = rate.den / rate.num;
		assert.ok(Math.abs(clip.startValue / clip.startRate - sourceSeconds) < 1e-12,
			'the OTIO reference reader must recover the exact native source boundary without sequence-grid quantization');
		assert.equal(clip.durationValue, 30); assert.equal(clip.durationRate, 30);
		assert.equal(project.clips[0]?.sourceInFrame, 1);
	});
}
