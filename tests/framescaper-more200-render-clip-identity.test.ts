/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperUnifiedRenderFoundation, finalizeFramescaperUnifiedRenderPlan } from '../src/framescaper/editor-project-unified-render-core.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createUnifiedExactRenderClipExportFrameSource } from '../src/common/editor/unified-exact-render-plan-consumers.ts';
import { renderAuthority } from './helpers/framescaper-unified-render-project-fixture.ts';
import { bindVideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import { generatedNodeId } from '../src/framescaper/editor-render-node-identity.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { createUnreportedVideoSourceCharacteristicsV25 } from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { videoPreviewBenchmarkMedia } from './browser/fixtures/video-preview-benchmark-media.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { reopenVisualAuthoringArchive } from './helpers/framescaper-visual-authoring-archive-custody.ts';

for (const clipId of ['picture', 'Picture 映像', 'clip "one"']) test(`native picture identity survives exact source addressing: ${clipId}`, async () => {
	const media = videoPreviewBenchmarkMedia;
	assert.equal(createHash('sha256').update(media.file.buffer).digest('hex'), media.sourceSha256);
	// Match the original archive's authored CFR180 declaration, not a claimed180-frame physical demux.
	const source = createVideoSource({ id: 'camera', name: 'Camera', storageKey: 'camera.webm', mimeType: 'video/webm',
		contentSha256: media.sourceSha256, frameRate: { num: 30, den: 1 }, sourceFrameCount: 180,
		sampleFrameCount: 288_000, width: 1280, height: 720 });
	const project = createFramescaperProject(PROFILE, { id: 'clip-identity', sampleRate: 48_000, sources: [source],
		clips: [{ kind: 'video', id: clipId, title: 'Picture', sourceId: source.id, sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 30, sourceFrameCount: 30 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: [clipId] }],
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main-sequence' });
	const verifyAddressing = (value: typeof project) => {
		const restoredSource = value.sources.find(candidate => candidate.id === source.id); assert.ok(restoredSource?.kind === 'video');
		const clip = value.clips.find(clip => clip.id === clipId); assert.ok(clip?.kind === 'video');
		assert.deepEqual([clip.id, clip.sourceId, clip.sequenceStartFrame, clip.sequenceFrameCount, clip.sourceInFrame, clip.sourceFrameCount],
			[clipId, source.id, 0, 30, 30, 30]);
		assert.deepEqual([restoredSource.sourceFrameCount, restoredSource.sampleFrameCount, restoredSource.width, restoredSource.height,
			restoredSource.contentSha256, restoredSource.timingAsset], [180, 288_000, 1280, 720, media.sourceSha256, null]);
		const timingViews = new Map([[source.id, { kind: 'cfr' as const, rate: { num: 30, den: 1 }, frameCount: 180 }]]);
		const foundation = createFramescaperUnifiedRenderFoundation(value, { ...renderAuthority({ ...value }, 10),
			outputRate: { num: 30, den: 1 }, sampleDuration: 48_000, timingViews });
		const plan = finalizeFramescaperUnifiedRenderPlan(foundation, 9, []);
		const node = plan.nodes.find(node => node.kind === 'clip'); assert.ok(node);
		assert.equal(node.clipId, clipId); assert.match(node.nodeId, /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u);
		const frames = createUnifiedExactRenderClipExportFrameSource(plan, clipId,
			new Map([[source.id, bindVideoSourceTimingView(timingViews, restoredSource)]]));
		for (const [outputFrame, ordinal] of [[0, 30], [1, 31]] as const) {
			const frame = frames.frameAt(outputFrame);
			assert.equal(frame.pictures[0]?.sourceOrdinal, ordinal);
			assert.equal(frame.pictures[0]?.sourceId, source.id);
		}
	};
	verifyAddressing(project);
	// The quoted identifier keeps the complete native renderer witness; avoid redundant archives for it.
	if (clipId === 'clip "one"') return;
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	try {
		await store.writeMediaAsset(source.storageKey, new Blob([media.file.buffer], { type: media.file.mimeType }), { name: media.file.name, mimeType: media.file.mimeType });
		// The native importer explicitly adds these professional-media defaults to original legacy input.
		const expected = { ...project, sources: [{ ...source, storageKey: source.id, proxyAttachment: null, imageSequence: null, characteristics: createUnreportedVideoSourceCharacteristicsV25() }] };
		const reopened = await reopenVisualAuthoringArchive(project, store, new Map([[source.storageKey, media.file.buffer]]), expected,
			new Map([[source.storageKey, source.id]]));
		verifyAddressing(reopened);
	} finally { await store.close(); }
});

test('derived artifact spellings cannot alias a readable logical owner', () => {
	const owner = 'Picture 映像';
	const crafted = `sha256:${fingerprintNativeMediaPlan({ family: 'clip', ownerId: owner }).sha256}`;
	const generated = generatedNodeId('clip', owner, new Set());
	assert.notEqual(generated, generatedNodeId('clip', crafted, new Set()));
	assert.throws(() => generatedNodeId('clip', owner, new Set([generated])), /collides with project identity/u);
});
