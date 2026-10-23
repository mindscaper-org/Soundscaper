/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { validateFileChoice } from '../desktop/validation.js';
import {
	createDesktopVideoTimingProbeFileHarness,
	createDesktopVideoTimingProbePlan,
	DESKTOP_VIDEO_TIMING_PROBE_MODE,
} from '../desktop/video-timing-probe-smoke.js';
import { openDesktopWorkspaceFiles } from '../src/common/editor/ui/workspace/desktop-workspace-file-choice.ts';
import { videoTimingProbeMedia } from './browser/fixtures/video-timing-probe-media.js';

function timingPlan(productId: 'soundscaper' | 'framescaper') {
	return createDesktopVideoTimingProbePlan({
		schemaVersion: 1,
		mode: DESKTOP_VIDEO_TIMING_PROBE_MODE,
		productId,
		token: '0123456789abcdef0123456789abcdef',
		fixtures: videoTimingProbeMedia.map(fixture => ({
			id: fixture.id,
			kind: fixture.kind,
			path: join(tmpdir(), fixture.file.name),
			name: fixture.file.name,
			sourceSha256: fixture.sourceSha256,
			nominalRate: fixture.nominalRate,
			timescale: fixture.timescale,
			presentationTicks: fixture.presentationTicks.map(String),
			finalFrameDurationTicks: String(fixture.finalFrameDurationTicks),
			timingSha256: fixture.timingSha256,
		})),
	});
}

for (const productId of ['soundscaper', 'framescaper'] as const) {
	for (const purpose of ['media', 'audio-video']) {
		test(`${productId} timing probe imports both fixtures through the ${purpose} workspace chooser`, async () => {
			const plan = timingPlan(productId);
			const harness = createDesktopVideoTimingProbeFileHarness(plan);
			const files = videoTimingProbeMedia.map(fixture => new File(
				[Uint8Array.from(fixture.file.buffer)], fixture.file.name, { type: fixture.file.mimeType },
			));
			let imported: readonly File[] = [];
			const count = await openDesktopWorkspaceFiles({
				getProjectId: () => 'timing-probe-project',
				fileService: {
					chooseFiles: request => Promise.resolve(harness.resolveOpenPaths(validateFileChoice(request))),
					withReadDescriptors: async (descriptors, _request, consume) => {
						assert.deepEqual(descriptors, plan.fixtures.map((fixture: { path: string }) => fixture.path));
						return consume(files);
					},
				},
				importFiles: selected => { imported = selected; },
			}, purpose, true);
			assert.equal(count, 2);
			assert.deepEqual(imported, files);
			assert.throws(() => harness.resolveOpenPaths(validateFileChoice({ purpose, multiple: true })), /already consumed/iu);
		});
	}
}

test('timing probe refuses other chooser requests without consuming its fixture selection', () => {
	const plan = timingPlan('framescaper');
	const harness = createDesktopVideoTimingProbeFileHarness(plan);
	for (const choice of [
		null,
		{ purpose: 'project', multiple: true },
		{ purpose: 'image', multiple: true },
		{ purpose: 'media', multiple: false },
		{ purpose: 'audio-video', multiple: false },
	]) {
		assert.throws(() => harness.resolveOpenPaths(choice), /ordinary multi-file/iu);
	}
	assert.deepEqual(harness.resolveOpenPaths({ purpose: 'audio-video', multiple: true }),
		plan.fixtures.map((fixture: { path: string }) => fixture.path));
});
