/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createLocalAssistanceSelectedVideoPreparation } from '../src/common/editor/controller/assistance/local-assistance-selected-video.ts';
import { countAudioEditorProjectValidationStructure as count, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS as LIMITS } from '../src/common/editor/project-validation-budget.ts';

const BYTES = Uint8Array.of(1, 2, 3, 4, 5, 6);
const DIGEST = createHash('sha256').update(BYTES).digest('hex');

function fixture() {
	const project = createFramescaperProject(PROFILE, { id: 'capacity-scope', sampleRate: 48_000,
		sources: [{ kind: 'video', id: 'video', storageKey: 'video', name: 'Video', mimeType: 'video/webm', contentSha256: DIGEST,
			width: 32, height: 24, frameRate: { num: 10, den: 1 }, frameCount: 480_000, sampleFrameCount: 480_000, sourceFrameCount: 100 }],
		clips: [{ kind: 'video', id: 'clip', sourceId: 'video', sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 100,
			sourceInFrame: 0, sourceFrameCount: 100, retimeMap: null }], tracks: [{ id: 'track', type: 'video', clipIds: ['clip'] }],
		sequences: [{ id: 'main-sequence', rate: { num: 10, den: 1 }, trackIds: ['track'] }], primarySequenceId: 'main-sequence',
		selection: { startFrame: 0, endFrame: 0, trackIds: ['track'], clipIds: ['clip'] } });
	const empty = { ...project, opaqueExtensions: { 'org.example.import-metadata': { retained: [] } } };
	const full = { ...empty, opaqueExtensions: { 'org.example.import-metadata': { retained: Array<unknown>(100_000 - count(empty, LIMITS) - 100).fill(0) } } };
	assert.ok(validateFramescaperProject(PROFILE, full));
	assert.equal(count(full, LIMITS), 99_900);
	const frames: number[][] = [];
	const preparation = createLocalAssistanceSelectedVideoPreparation({ getProject: () => full, getSelectedClipId: () => 'clip',
		captureProject: () => full, assertProject: token => assert.equal(token, full),
		store: { async loadMediaAsset() { return new Blob([BYTES], { type: 'video/webm' }); } },
		createVisualFramePack: request => { frames.push(request.timing.frames.map(frame => frame.sourceFrame));
			return new Blob(['frame-pack'], { type: 'application/vnd.soundscaper.frame-pack' }); },
	});
	return { preparation, frames };
}

test('Advanced selected-video primitives do not reserve unrelated crop publication capacity', async () => {
	const { preparation, frames } = fixture();
	for (const operation of ['image-text-embedding', 'optical-character-recognition', 'subject-detection', 'saliency-detection'] as const) {
		const prepared = await preparation.prepareSelectedMedia({ sourceId: 'video', operation });
		assert.equal(prepared.operation, operation);
		assert.equal(prepared.inputs.length, 1);
		assert.equal(prepared.outputs[0]?.maximumByteLength, 64 * 1024 * 1024);
	}
	assert.deepEqual(frames, Array.from({ length: 4 }, () => Array.from({ length: 20 }, (_, index) => index * 5)));
});

test('Guided Reframe still refuses impossible crop publication before decoding either model input', async () => {
	const { preparation, frames } = fixture();
	for (const operation of ['subject-detection', 'saliency-detection'] as const) {
		await assert.rejects(preparation.prepareSelectedMedia({ sourceId: 'video', operation, publicationTarget: 'reframe' }), /room in the project/u);
	}
	assert.deepEqual(frames, []);
	for (const publicationTarget of ['other', false, null]) {
		await assert.rejects(preparation.prepareSelectedMedia({ sourceId: 'video', operation: 'saliency-detection', publicationTarget } as never), /publication target/u);
	}
	await assert.rejects(preparation.prepareSelectedMedia({ sourceId: 'video', operation: 'image-text-embedding', publicationTarget: 'reframe' }), /publication target/u);
	const controller = new AbortController(); controller.abort();
	await assert.rejects(preparation.prepareSelectedMedia({ sourceId: 'video', operation: 'optical-character-recognition', signal: controller.signal }), { name: 'AbortError' });
	assert.deepEqual(frames, []);
});
