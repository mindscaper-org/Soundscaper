/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createExportPlan } from '../src/common/editor/export.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

for (const markerSource of ['timeline-annotations', 'label-track'] as const) {
	test(`a point cue with a valid source sample does not land beyond the resampled WAV (${markerSource})`, () => {
		const project = createCurrentAudioEditorProject({ sampleRate: 48_000,
			tracks: [{ id: 'labels', type: 'label', name: 'Cues', labels: [{ id: 'point', title: 'Last sample', startFrame: 2, endFrame: 2 }] }],
			timelineAnnotations: [{ id: 'point', sequenceId: 'main-sequence', kind: 'marker', anchor: 'sample', name: 'Last sample', positionFrame: 2, color: 'auto', batchId: null, opaqueExtensions: {} }],
		});
		const plan = createExportPlan(project, { format: 'wav', markerSource, sampleRate: 16_000, range: { startFrame: 0, endFrame: 3 } });
		assert.equal(plan.outputFrames, 1);
		assert.deepEqual(plan.markers.map(({ sampleOffset, sampleLength }) => [sampleOffset, sampleLength]), [[0, 0]]);
	});

	test(`a named region through the resampled WAV end includes its delivered sample (${markerSource})`, () => {
		const project = createCurrentAudioEditorProject({ sampleRate: 48_000,
			tracks: [{ id: 'labels', type: 'label', name: 'Cues', labels: [{ id: 'region', title: 'Full selection', startFrame: 0, endFrame: 1 }] }],
			timelineAnnotations: [{ id: 'region', sequenceId: 'main-sequence', kind: 'region', anchor: 'sample', name: 'Full selection', startFrame: 0, endFrame: 1, color: 'auto', batchId: null, opaqueExtensions: {} }],
		});
		const plan = createExportPlan(project, { format: 'wav', markerSource, sampleRate: 16_000, range: { startFrame: 0, endFrame: 1 } });
		assert.equal(plan.outputFrames, 1);
		assert.deepEqual(plan.markers.map(({ sampleOffset, sampleLength }) => [sampleOffset, sampleLength]), [[0, 1]]);
	});
}
