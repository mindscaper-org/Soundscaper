/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
	ASSISTANCE_WORKFLOW_IDS, assistanceWorkflowStageGraph, validateAssistanceWorkflow,
	type AssistanceWorkflowId, type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import { defaultAssistanceWorkflowSettingsV1 } from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { assistanceWorkflowFixture, WORKFLOW_JOB_ID } from './helpers/assistance-workflow-fixture.ts';
import { readDesktopPreloadSource } from './helpers/desktop-preload-source.mjs';

interface Variant {
	readonly workflowId: AssistanceWorkflowId;
	readonly settings?: Readonly<Record<string, unknown>>;
	readonly recognizeSpeech?: boolean;
	readonly tagReactions?: boolean;
	readonly accurate?: boolean;
}
interface Bridge { readonly localAssistance: { readonly workflow: { run(request: unknown): Promise<unknown> } } }

const variants: Variant[] = ASSISTANCE_WORKFLOW_IDS.map(workflowId => ({ workflowId }));
for (const mode of ['fast', 'accurate']) {
	variants.push({ workflowId: 'mark-cuts', settings: { mode } });
	for (const includeOcr of [false, true]) variants.push({ workflowId: 'index-video', settings: { shotMode: mode, includeOcr } });
}
for (const englishWhisperAlignment of ['off', 'when-installed']) variants.push({
	workflowId: 'transcribe-captions', settings: { recognizer: 'whisper', language: 'en', englishWhisperAlignment },
});
variants.push({ workflowId: 'clean-filler-silence', recognizeSpeech: true },
	{ workflowId: 'make-highlights', settings: { editorialRerank: true }, tagReactions: true },
	{ workflowId: 'advanced:shot-detection', accurate: true });
for (const workflowId of ['enhance-dialogue', 'reduce-reverb', 'separate-dialogue-music-effects'] as const) {
	variants.push({ workflowId, settings: { placement: 'project-bin' } });
}
variants.push({ workflowId: 'separate-dialogue-music-effects', settings: { placement: 'muted-aligned-tracks' } });

test('every guided and Advanced recipe crosses the production preload with the domain-admitted request intact', async t => {
	let bridge: Bridge | undefined;
	const forwarded: AssistanceWorkflowV1[] = [];
	vm.runInNewContext(await readDesktopPreloadSource(), { ArrayBuffer, Uint8Array, URL,
		require: () => ({ contextBridge: { exposeInMainWorld(name: string, value: { v1: Bridge }) {
			if (name === 'scapeDesktop') bridge = value.v1;
		} }, ipcRenderer: { invoke(_channel: string, request: AssistanceWorkflowV1) {
			forwarded.push(structuredClone(request));
			return Promise.resolve({ contractVersion: 1, jobId: request.jobId,
				workflowId: request.workflowId, outcome: 'consent-declined' });
		}, send() {}, on() {}, removeListener() {} } }),
	});
	assert.ok(bridge);
	assert.equal(new Set(variants.map(({ workflowId }) => workflowId)).size, ASSISTANCE_WORKFLOW_IDS.length);
	for (const variant of variants) await t.test(JSON.stringify(variant), async () => {
		const request = recipe(variant);
		await bridge!.localAssistance.workflow.run(request);
		assert.deepEqual(forwarded.at(-1), request);
		const count = forwarded.length;
		const invalid = { ...request, fence: { ...request.fence, sourceRanges: request.fence.sourceRanges.map(range => ({
			...range, timelinePlacementOffsetFrames: 0.5,
		})) } };
		assert.throws(() => validateAssistanceWorkflow(invalid));
		await assert.rejects(bridge!.localAssistance.workflow.run(invalid));
		assert.equal(forwarded.length, count);
	});
});

function recipe(variant: Variant): AssistanceWorkflowV1 {
	const { workflowId } = variant;
	const settings: Record<string, unknown> = { ...defaultAssistanceWorkflowSettingsV1(workflowId), ...variant.settings };
	if (workflowId === 'generate-editorial-text') settings.enabled = true;
	const accurate = variant.accurate || settings.mode === 'accurate' || settings.shotMode === 'accurate';
	const graph = assistanceWorkflowStageGraph(workflowId).filter(stage => stage.required
		|| stage.stageId === 'recognize-text' && settings.includeOcr
		|| stage.stageId === 'align-words' && settings.recognizer === 'whisper' && settings.englishWhisperAlignment === 'when-installed'
		|| stage.stageId === 'recognize-speech' && variant.recognizeSpeech
		|| stage.stageId === 'tag-highlight-reactions' && variant.tagReactions
		|| stage.stageId === 'rerank-editorial' && settings.editorialRerank);
	const inputs: AssistanceWorkflowV1['inputs'][number][] = [];
	const outputs: AssistanceWorkflowV1['outputs'][number][] = [];
	const models: AssistanceWorkflowV1['models'][number][] = [];
	const produced = new Map<string, string>();
	let ordinal = 0;
	const claim = <Direction extends 'input' | 'output'>(direction: Direction, stageId: string, slotId: string, claimId?: string) => ({
		claimVersion: 1 as const, direction, stageId, slotId, jobId: WORKFLOW_JOB_ID,
		claimId: claimId ?? (++ordinal).toString(16).padStart(40, '0'),
	});
	for (const stage of graph) {
		let slots = stage.inputSlots.filter(slot => slot.required || produced.has(slot.slotId));
		if (stage.operation === 'shot-detection' && !slots.length) slots = stage.inputSlots.filter(slot => slot.slotId === (accurate ? 'frame-pack' : 'video'));
		if (!slots.length && workflowId.startsWith('advanced:')) slots = stage.inputSlots.filter(slot => slot.slotId === (stage.operation === 'image-text-embedding' ? 'frame-pack' : 'text'));
		for (const slot of slots) inputs.push(claim('input', stage.stageId, slot.slotId, produced.get(slot.slotId)));
		for (const slot of stage.outputSlots.filter(slot => slot.required)) {
			const output = claim('output', stage.stageId, slot.slotId);
			outputs.push(output);
			produced.set(slot.slotId, output.claimId);
		}
		for (const slot of stage.modelSlots.filter(slot => slot.required || stage.operation === 'shot-detection' && accurate)) {
			models.push({ bindingVersion: 1, stageId: stage.stageId, slotId: slot.slotId,
				modelId: `fixture-${slot.slotId}`, version: '1.0.0', artifactSha256s: ['ab'.repeat(32)] });
		}
	}
	return validateAssistanceWorkflow(assistanceWorkflowFixture({ workflowId, settings,
		stageIds: graph.map(({ stageId }) => stageId), models, inputs, outputs }));
}
