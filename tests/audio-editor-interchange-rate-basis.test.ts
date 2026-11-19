/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { interchangeClipControls } from '../src/common/editor/timeline-interchange-audio-controls.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createDeliveryReport } from '../src/common/editor/delivery-report.ts';
import type { TimelineInterchangeDocument } from '../src/common/editor/timeline-interchange-types.ts';

// This safe integer's 160/147 change of basis loses one sample with a floating product.
const AUTHORED_FRAME = 4_503_599_627_370_000;
const PROJECT_FRAME = 4_901_877_145_436_735;

test('interchange envelopes preserve exact sample positions during a rate change', () => {
	const controls = interchangeClipControls({ id: 'clip', name: 'Clip', mediaId: 'source',
		start: { num: 0, den: 1 }, sourceStart: { num: 0, den: 1 }, duration: { num: 1, den: 1 },
		envelope: [{ frame: 0, value: 1 }, { frame: AUTHORED_FRAME, value: 0.5 }],
	}, 48_000, PROJECT_FRAME + 160, 'reaper', createDeliveryReport({ format: 'reaper' }), 44_100);
	assert.deepEqual(controls.envelope?.map(point => point.frame), [0, PROJECT_FRAME, PROJECT_FRAME + 160]);
});

test('interchange marker endpoints and automation use the same exact change of basis', () => {
	const document: TimelineInterchangeDocument = { format: 'reaper', title: 'Clock boundaries', sampleRate: 44_100,
		rate: { num: 25, den: 1 }, dropFrame: false, startFrameCount: 0, media: [], issues: [],
		tracks: [{ id: 'voice', name: 'Voice', kind: 'audio', clips: [], automation: [{ parameter: 'gain', points: [
			{ frame: 0, value: 1, interpolation: 'linear' },
			{ frame: AUTHORED_FRAME, value: 0.5, interpolation: 'hold' },
		] }] }], markers: [{ frame: AUTHORED_FRAME, name: 'Marker' },
			{ frame: AUTHORED_FRAME, endFrame: AUTHORED_FRAME + 147, name: 'Region' }],
	};
	let ordinal = 0;
	const plan = buildTimelineInterchangeProject(document, { sampleRate: 48_000, createStableId: prefix => `${prefix}-${++ordinal}` });
	assert.deepEqual(plan.production.automationLanes[0]?.points.map(point => point.position), [0, PROJECT_FRAME]);
	const annotations = plan.project.timelineAnnotations as readonly Readonly<Record<string, unknown>>[];
	assert.equal(annotations[0]?.positionFrame, PROJECT_FRAME);
	assert.equal(annotations[1]?.startFrame, PROJECT_FRAME);
	assert.equal(annotations[1]?.endFrame, PROJECT_FRAME + 160);
});
