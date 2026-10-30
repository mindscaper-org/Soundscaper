/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewLocalAssistanceGuidedResult } from '../src/common/editor/assistance/local-assistance-guided-result-review.ts';
import type { AssistanceWorkflowV1 } from '../src/common/editor/assistance/workflow.ts';
import { createLocalAssistanceGuidedResultAcceptance } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-result-acceptance.ts';
import { acknowledgeLocalAssistanceGuidedEditorialSelection } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-editorial-acceptance.ts';
import { localAssistanceGuidedAcceptanceReview } from '../src/common/editor/ui/local-assistance-guided-acceptance-review.ts';
import { localizedGuidedReviewChoice } from '../src/common/editor/ui/guided-review-choice-label.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';

test('actual caption review accepts its localized UI selection without changing proposal authority', async () => {
	const workflow = assistanceWorkflowFixture();
	const review = await reviewed(workflow, jsonBody('captions', {
		schemaVersion: 1, kind: 'captions', sourceId: 'source-a', sampleRate: 48_000, alignmentApplied: false,
		cues: [{ cueId: 'caption:0', startFrame: 0, endFrame: 24_000, text: 'Authored words', words: [] }],
	}));
	const choice = review.choices[0]; assert.ok(choice);
	const original = localizedGuidedReviewChoice(choice, { 'ui.localAssistance.localAssistanceChoiceCaptionOne': '{count} Untertitel' }, new Intl.NumberFormat('de'));
	assert.equal(original, '1 Untertitel');
	const publications: unknown[] = [];
	const adapter = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(workflow), assertCurrentWorkflowFence: async () => undefined,
		acceptValidatedResult: async request => { publications.push(request); },
	});
	const boundary = localAssistanceGuidedAcceptanceReview(review);
	const available = adapter.createAcceptanceSession({ workflow, reviewedResult: boundary });
	assert.equal(available.outcome, 'ready'); assert.ok(available.outcome === 'ready');
	assert.deepEqual(await available.session.accept([choice.id]), { outcome: 'accepted', selectedIds: ['captions'] });
	assert.equal(publications.length, 1);
	assert.equal((publications[0] as { operation: string }).operation, 'speech-recognition');
	assert.equal(boundary.outputs, review.outputs, 'authenticated output bodies and hashes keep their exact identity');
	assert.deepEqual(Object.keys(boundary.choices[0] ?? {}).sort(), ['enabled', 'id', 'kind', 'label', 'selected']);
	assert.ok(choice.presentation, 'localization metadata remains on the retained UI review');
	assert.equal(localizedGuidedReviewChoice(choice, { 'ui.localAssistance.localAssistanceChoiceCaptionOne': '{count} légende' }, new Intl.NumberFormat('fr')), '1 légende');
});

test('actual enhanced audio review retains geometry and publication placement across the UI boundary', async () => {
	const stage = 'enhance-dialogue';
	const workflow = assistanceWorkflowFixture({ workflowId: stage, stageIds: [stage],
		models: [{ bindingVersion: 1, stageId: stage, slotId: 'enhancer', modelId: 'deepfilternet3', version: '3.0.6', artifactSha256s: ['03'.repeat(32)] }],
		inputs: [claim('input', stage, 'audio', 1)], outputs: [claim('output', stage, 'enhanced-audio', 2)] });
	const bytes = encodeWav([new Float32Array(96_000).fill(0.25)], { sampleRate: 48_000, bitDepth: 32, float: true, dither: false });
	const review = await reviewed(workflow, new Blob([bytes.slice().buffer], { type: 'audio/wav' }), {
		reviewAuthorityVersion: 1, audioWave: { sampleRate: 48_000, channelCount: 1, frameCount: 96_000 },
		editorialCandidateIds: null, highlightVideoSignals: null, media: { audio: null, video: null },
	});
	const calls: unknown[] = [];
	const adapter = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(workflow), assertCurrentWorkflowFence: async () => undefined,
		acceptAudioResult: async (request, placement) => { calls.push({ request, placement }); },
	});
	const available = adapter.createAcceptanceSession({ workflow, reviewedResult: localAssistanceGuidedAcceptanceReview(review) });
	assert.ok(available.outcome === 'ready');
	assert.deepEqual(await available.session.accept(['enhanced-audio']), { outcome: 'accepted', selectedIds: ['enhanced-audio'] });
	assert.equal(calls.length, 1);
	assert.deepEqual((calls[0] as { placement: unknown }).placement, { placement: 'project-bin' });
	assert.deepEqual(review.outputs[0]?.semantic, { kind: 'audio-wave', role: 'enhanced-audio', sampleRate: 48_000, channelCount: 1, frameCount: 96_000, sampleFormat: 'float32' });
});

test('actual editorial item review acknowledges its exact candidate after localized display', async () => {
	const candidateId = 'selection:121212121212121212121212';
	const stage = 'generate-editorial-text';
	const base = assistanceWorkflowFixture({ workflowId: stage, stageIds: [stage],
		settings: { settingsVersion: 1, workflowId: stage, enabled: true, fields: ['title', 'hook', 'chapters', 'explanation'] },
		models: [{ bindingVersion: 1, stageId: stage, slotId: 'editorial-generator', modelId: 'qwen3-4b-q4-k-m', version: '1.0.0', artifactSha256s: ['78'.repeat(32)] }],
		inputs: [claim('input', stage, 'editorial-context', 1)], outputs: [claim('output', stage, 'editorial-proposal', 2)] });
	const workflow = { ...base, fence: { ...base.fence, transcriptBodySha256: '90'.repeat(32) } };
	const review = await reviewed(workflow, jsonBody('editorial-proposal', { schemaVersion: 1,
		candidates: [{ candidateId, title: 'Authored title', hook: null, chapters: ['Opening'], explanation: null }],
	}), { reviewAuthorityVersion: 1, audioWave: null, editorialCandidateIds: [candidateId], highlightVideoSignals: null, media: { audio: null, video: null } });
	const choice = review.choices[0]; assert.ok(choice);
	assert.equal(localizedGuidedReviewChoice(choice, { 'ui.localAssistance.localAssistanceChoiceEditorial': 'Redaktioneller Text {index}' }, new Intl.NumberFormat('de')), 'Redaktioneller Text 1');
	assert.deepEqual(acknowledgeLocalAssistanceGuidedEditorialSelection({ workflow,
		reviewedResult: localAssistanceGuidedAcceptanceReview(review), selectedChoiceIds: [candidateId] }),
	{ outcome: 'accepted', selectedIds: [candidateId] });
});

test('the boundary preserves unknown choice fields and altered identities for strict rejection', async () => {
	const workflow = assistanceWorkflowFixture();
	const review = await reviewed(workflow, jsonBody('captions', { schemaVersion: 1, kind: 'captions', sourceId: 'source-a', sampleRate: 48_000, alignmentApplied: false,
		cues: [{ cueId: 'caption:0', startFrame: 0, endFrame: 24_000, text: 'Words', words: [] }] }));
	const adapter = createLocalAssistanceGuidedResultAcceptance({
		currentSelectionFence: () => primitiveFence(workflow), assertCurrentWorkflowFence: async () => undefined,
		acceptValidatedResult: async () => { throw new Error('invalid authority must never publish'); },
	});
	for (const extra of [{ unexpectedAuthority: true }, { id: 'foreign-caption' }]) {
		const altered = { ...review, choices: [{ ...review.choices[0]!, ...extra }] };
		assert.throws(() => adapter.createAcceptanceSession({ workflow, reviewedResult: localAssistanceGuidedAcceptanceReview(altered) }), /exactly its schema fields|changed reviewed proposal authority/u);
	}
});

function reviewed(workflow: AssistanceWorkflowV1, body: Blob,
	authority?: Parameters<typeof reviewLocalAssistanceGuidedResult>[0]['authority']) {
	return reviewLocalAssistanceGuidedResult({ workflow,
		result: { contractVersion: 1, jobId: workflow.jobId, workflowId: workflow.workflowId, stageIds: workflow.stageIds, outputs: workflow.outputs },
		readOutput: async () => body, ...(authority ? { authority } : {}),
	});
}
function jsonBody(slotId: string, value: unknown): Blob { return new Blob([JSON.stringify(value)], { type: `application/vnd.soundscaper.${slotId}+json` }); }
function claim<const Direction extends 'input' | 'output'>(direction: Direction, stageId: string, slotId: string, index: number) {
	return { claimVersion: 1 as const, direction, claimId: index.toString(16).padStart(40, '0'), jobId: WORKFLOW_JOB_ID, stageId, slotId };
}
function primitiveFence(workflow: AssistanceWorkflowV1) {
	const range = workflow.fence.sourceRanges[0]!;
	return { projectId: workflow.fence.projectId, schemaFamily: workflow.fence.schemaFamily, schemaVersion: workflow.fence.schemaVersion,
		revision: workflow.fence.revision, sequenceId: workflow.fence.sequenceId, occurrenceIds: range.occurrenceIds,
		sourceId: range.sourceId, sourceSha256: range.sourceSha256, sourceStartFrame: range.sourceStartFrame, sourceEndFrame: range.sourceEndFrame,
		linkMembershipSha256: range.linkMembershipSha256, timingAuthoritySha256: range.timingAuthoritySha256 };
}
