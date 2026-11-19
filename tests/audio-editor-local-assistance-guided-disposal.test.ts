/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { LocalAssistanceWorkflowBridge } from '../src/common/editor/assistance/local-assistance-workflow-bridge.ts';
import type { LocalAssistanceSelectedMediaPreparationPort } from '../src/common/editor/assistance/local-assistance-preparation.ts';
import { createLocalAssistanceGuidedSessionStore } from '../src/common/editor/ui/local-assistance-guided-session-store.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';
import { deferred } from './helpers/async-test-control.ts';

test('closing a Guided session retains native output custody until acceptance finishes', async () => {
	const pending = deferred<void>();
	const events: string[] = [];
	const captions = new Blob([JSON.stringify({ schemaVersion: 1, kind: 'captions', sourceId: 'source-a', sampleRate: 48_000,
		alignmentApplied: false, cues: [{ cueId: 'caption:0', startFrame: 0, endFrame: 24_000, text: 'Hello', words: [] }] })],
	{ type: 'application/vnd.soundscaper.captions+json' });
	const workflow: LocalAssistanceWorkflowBridge = {
		custody: { stageInput: async () => { throw new Error('Already staged'); }, reserveOutput: async () => { throw new Error('Already reserved'); },
			bindProducer: async () => { throw new Error('Already bound'); }, release: async () => { events.push('release'); return true; } },
		createJob: async () => ({ contractVersion: 1, jobId: WORKFLOW_JOB_ID }),
		run: async request => ({ contractVersion: 1, jobId: request.jobId, workflowId: request.workflowId, outcome: 'completed',
			result: { contractVersion: 1, jobId: request.jobId, workflowId: request.workflowId, stageIds: request.stageIds, outputs: request.outputs } }),
		cancel: async jobId => ({ contractVersion: 1, jobId, outcome: 'cancelled' }), readOutput: async () => captions, onProgress: () => () => {},
	};
	const preparation: LocalAssistanceSelectedMediaPreparationPort = {
		listSelectedMedia: async () => ({ sources: [] }), prepareSelectedMedia: async () => { throw new Error('Guided only'); },
		prepareGuidedWorkflow: async request => ({ outcome: 'prepared',
			workflow: assistanceWorkflowFixture({ jobId: request.jobId, workflowId: request.workflowId, settingsVersion: request.settings.settingsVersion }),
			reviewAuthority: { reviewAuthorityVersion: 1, audioWave: null, editorialCandidateIds: null, highlightVideoSignals: null, media: { audio: null, video: null } } }),
		acceptGuidedWorkflowResult: async request => {
			await pending.promise;
			assert.deepEqual([...events], [], 'native output must remain readable during acceptance');
			events.push('publish');
			return { outcome: 'accepted', selectedIds: request.selectedChoiceIds };
		},
	};
	const store = createLocalAssistanceGuidedSessionStore({ bridge: { workflow, models: async () => [] }, preparation });
	store.selectWorkflow('transcribe-captions');
	await store.run();
	await store.review();
	store.setReviewChoiceSelected('captions', true);
	const accepting = store.accept();
	assert.equal(store.accept(), accepting, 'repeated Apply retains the same pending acceptance');
	const disposing = store.dispose().then(() => { events.push('disposed'); });
	try {
		await new Promise(resolve => setImmediate(resolve));
		assert.deepEqual(events, []);
	} finally {
		pending.resolve(undefined);
		await Promise.all([accepting, disposing]);
	}
	assert.deepEqual(events, ['publish', 'release', 'disposed']);
});
