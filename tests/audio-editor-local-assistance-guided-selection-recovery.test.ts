/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultAssistanceWorkflowSettingsV1 } from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { assertSafeProjectTopology, projectRecord } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-admission.ts';
import { JOB_ID, model, preparationFixture, project } from './helpers/audio-editor-local-assistance-guided-preparation-fixture.ts';

test('guided analysis recovers restored selection after an effect undo leaves deleted clip focus', async () => {
	for (const focusedId of ['assistance-clip-undone', null]) {
		const restored = { ...project(),
			selection: { startFrame: 24_000, endFrame: 72_000, trackIds: ['voice-track'],
				clipIds: focusedId ? ['voice-clip'] : [] },
			clips: project().clips.map(clip => ({ ...clip, durationFrames: 96_000, sourceDurationFrames: 96_000 })),
		};
		const fixture = preparationFixture(restored, false, undefined, focusedId);
		const result = await fixture.preparation.prepareGuidedWorkflow({ jobId: JOB_ID,
			workflowId: 'detect-beats-tempo', settings: defaultAssistanceWorkflowSettingsV1('detect-beats-tempo'),
			models: [model('beat-this-small0', '1.1.0', 'beat-tracking', 1)],
			custody: fixture.custody, signal: new AbortController().signal,
		});
		assert.equal(result.outcome, 'prepared', JSON.stringify(result));
		assert.deepEqual(fixture.operations, ['beat-tracking']);
		assert.ok(fixture.custodyEvents.some(({ kind }) => kind === 'input'));
	}
});

test('guided topology admits an explicitly selected video without recovering unselected media', () => {
	const video = { ...project(), clips: [{ id: 'video-clip', kind: 'video', sourceId: 'video-source',
		reversed: false, speedRatio: 1 }], sources: [{ id: 'video-source', kind: 'video' }],
		selection: { startFrame: 0, endFrame: 0, trackIds: [], clipIds: ['video-clip'] } };
	assert.doesNotThrow(() => assertSafeProjectTopology(projectRecord(video, null)));
	const unselected = { ...video, selection: { ...video.selection, clipIds: [] } };
	assert.throws(() => assertSafeProjectTopology(projectRecord(unselected, 'deleted-clip')),
		/selected-media-unavailable/iu);
});
