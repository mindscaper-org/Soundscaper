/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperNativeServicesStoreFor } from '../src/common/editor/ui/framescaper-native-services-bridge.ts';
import { publishEvaluatedVideoPreviewFrame } from '../src/common/editor/ui/workspace/video-preview-external-display.ts';
import { createRound7ExternalDisplayNativeFixture } from './helpers/round7-external-display-native-fixture.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { unifiedExactPlanFixture } from './helpers/unified-exact-render-plan-fixture.ts';

for (const id of ['ordinary-project', 'programme:one', 'Programme one', '映像の企画', 'p'.repeat(160)]) {
	test(`a native programme identity reaches the actual clean display: ${id.slice(0, 24)}`, async () => {
		const native = createRound7ExternalDisplayNativeFixture();
		try {
			const project = createFramescaperProject(PROFILE, { id });
			const plan = createUnifiedExactRenderPlan({ ...unifiedExactPlanFixture(9), project: { id, revision: project.revision } });
			assert.equal(plan.project.id, project.id);
			await native.bridge.setExternalDisplay({ displayId: 'display-2' });
			await framescaperNativeServicesStoreFor(native.bridge).refresh();
			assert.equal(publishEvaluatedVideoPreviewFrame({ project, timelineFrame: 0,
				compositor: { captureEvaluatedRgba: () => ({ width: 1, height: 1, rgba: Uint8Array.of(255, 0, 0, 255) }) },
			}, { resolveBridge: () => native.bridge }), true);
			for (let attempts = 0; attempts < 100 && native.frames.length === 0; attempts++) await setImmediate();
			assert.equal(native.frames.length, 1);
			assert.equal(native.frames[0]?.windowId, 1);
			assert.equal(native.settlements[0]?.outcome, 'result');
		} finally { await native.dispose(); }
	});
}

test('external display still refuses a missing project identity or invalid revision before capture', async () => {
	const native = createRound7ExternalDisplayNativeFixture();
	try {
		await native.bridge.setExternalDisplay({ displayId: 'display-2' });
		await framescaperNativeServicesStoreFor(native.bridge).refresh();
		let captures = 0;
		for (const project of [{ id: '', revision: 0 }, { id: ' \t', revision: 0 }, { id: 'programme', revision: -1 }]) {
			assert.throws(() => createUnifiedExactRenderPlan({ ...unifiedExactPlanFixture(9), project }));
			assert.throws(() => publishEvaluatedVideoPreviewFrame({ project, timelineFrame: 0,
				compositor: { captureEvaluatedRgba: () => { captures++; return null; } },
			}, { resolveBridge: () => native.bridge }), /project identity/iu);
		}
		assert.equal(captures, 0); assert.equal(native.frames.length, 0);
	} finally { await native.dispose(); }
});
