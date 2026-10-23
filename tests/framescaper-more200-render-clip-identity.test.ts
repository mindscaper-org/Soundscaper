/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperUnifiedRenderFoundation, finalizeFramescaperUnifiedRenderPlan } from '../src/framescaper/editor-project-unified-render-core.ts';
import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import { createUnifiedExactRenderClipExportFrameSource } from '../src/common/editor/unified-exact-render-plan-consumers.ts';
import { renderAuthority } from './helpers/framescaper-unified-render-project-fixture.ts';
import { bindVideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';
import { generatedNodeId } from '../src/framescaper/editor-render-node-identity.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';

for (const clipId of ['picture', 'Picture 映像', 'clip "one"']) test(`native picture identity survives exact source addressing: ${clipId}`, () => {
	const source = createVideoSource({ id: 'camera', name: 'Camera', storageKey: 'camera.webm', mimeType: 'video/webm',
		contentSha256: 'ab'.repeat(32), frameRate: { num: 30, den: 1 }, sourceFrameCount: 180,
		sampleFrameCount: 288_000, width: 1280, height: 720 });
	const project = createFramescaperProject(PROFILE, { id: 'clip-identity', sampleRate: 48_000, sources: [source],
		clips: [{ kind: 'video', id: clipId, title: 'Picture', sourceId: source.id, sequenceId: 'main-sequence',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 30, sourceFrameCount: 30 }],
		tracks: [{ id: 'pictures', type: 'video', clipIds: [clipId] }],
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main-sequence' });
	const timingViews = new Map([[source.id, { kind: 'cfr' as const, rate: { num: 30, den: 1 }, frameCount: 180 }]]);
	const foundation = createFramescaperUnifiedRenderFoundation(project, { ...renderAuthority({ ...project }, 10),
		outputRate: { num: 30, den: 1 }, sampleDuration: 48_000, timingViews });
	const plan = finalizeFramescaperUnifiedRenderPlan(foundation, 9, []);
	const node = plan.nodes.find(node => node.kind === 'clip'); assert.ok(node);
	assert.equal(node.clipId, clipId); assert.match(node.nodeId, /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,4095}$/u);
	const frame = createUnifiedExactRenderClipExportFrameSource(plan, clipId,
		new Map([[source.id, bindVideoSourceTimingView(timingViews, source)]])).frameAt(0);
	assert.equal(frame.pictures[0]?.sourceOrdinal, 30);
	assert.equal(frame.pictures[0]?.sourceId, source.id);
});

test('derived artifact spellings cannot alias a readable logical owner', () => {
	const owner = 'Picture 映像';
	const crafted = `sha256:${fingerprintNativeMediaPlan({ family: 'clip', ownerId: owner }).sha256}`;
	const generated = generatedNodeId('clip', owner, new Set());
	assert.notEqual(generated, generatedNodeId('clip', crafted, new Set()));
	assert.throws(() => generatedNodeId('clip', owner, new Set([generated])), /collides with project identity/u);
});
