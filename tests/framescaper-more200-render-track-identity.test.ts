/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

for (const trackId of ['track-1', 'Pictures 映像', 'track "one"']) test(`render placement retains a native track identity: ${trackId}`, () => {
	const raw = unifiedExactPlanFixture(10);
	const input = { ...raw, tracks: raw.tracks.map(track => ({ ...track, trackId })),
		nodes: raw.nodes.filter(node => node.kind === 'visual').map(node => ({ ...node, placement: { trackId } })) };
	const plan = createUnifiedExactRenderPlan(input);
	assert.equal(plan.tracks[0]?.trackId, trackId);
	const visual = plan.nodes.find(node => node.kind === 'visual'); assert.ok(visual);
	assert.equal(visual.placement?.trackId, trackId);
	assert.throws(() => createUnifiedExactRenderPlan({ ...input, nodes: input.nodes.map(node => ({ ...node, nodeId: 'unsafe artifact?' })) }), /stable ID/u);
	assert.throws(() => createUnifiedExactRenderPlan({ ...input, nodes: input.nodes.map(node => ({ ...node, placement: { trackId: 'missing' } })) }), /unknown video track/u);
});
