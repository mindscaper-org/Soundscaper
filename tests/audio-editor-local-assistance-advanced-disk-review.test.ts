/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { openAsBlob } from 'node:fs';
import { mkdtemp, open, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import type { LocalAssistancePreparedMedia, LocalAssistancePreparedOutput } from
	'../src/common/editor/assistance/local-assistance-preparation.ts';
import { resolveLocalAssistanceWorkflowBridge, type LocalAssistanceWorkflowCustodyBridge } from
	'../src/common/editor/assistance/local-assistance-workflow-bridge.ts';
import { createAssistanceWorkflowCustodyClaimV1, workflowClaimFromCustodyV1 } from
	'../src/common/editor/assistance/workflow-custody-v1.ts';
import type { AssistanceWorkflowV1 } from '../src/common/editor/assistance/workflow.ts';
import { bindLocalAssistancePreparedAudioWaveRelease } from
	'../src/common/editor/controller/assistance/local-assistance-audio-spool-release.ts';
import { createLocalAssistanceAdvancedWorkflowPreparation } from
	'../src/common/editor/controller/assistance/internal/local-assistance-advanced-workflow-preparation.ts';
import { createLocalAssistanceAdvancedWorkflowSessionStore } from
	'../src/common/editor/ui/local-assistance-advanced-session-store.ts';
import { createWavHeader } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

const JOB_ID = '7a'.repeat(20);
const SOURCE_SHA256 = '3a'.repeat(32);
const FRAME_COUNT = 4_200_000;
const PROJECT_RATE = 48_000;
const CASES = [
	['speech-enhancement', 'deepfilternet3', '3.0.0', 48_000, ['enhanced-audio']],
	['dereverberation', 'dereverb-room', '1.0.0', 44_100, ['dereverberated-audio']],
	['source-separation', 'tiger-dnr', '1.0.0', 44_100, ['dialogue', 'music', 'effects']],
] as const;

for (const profile of CASES) test(`Advanced ${profile[0]} reviews after its physical input is released`, async context => {
	const fixture = await diskReviewFixture(context, profile);
	await fixture.store.run();
	const { phase, error, result } = fixture.store.getSnapshot();
	assert.equal(phase, 'completed', error ?? undefined);
	assert.deepEqual(result?.outputs.map(({ slotId, review }) => {
		assert.equal(review.kind, 'audio-wave');
		return [slotId, review.sampleRate, review.channelCount, review.frameCount];
	}), profile[4].map(slotId => [slotId, profile[3], 2, FRAME_COUNT]));
	assert.deepEqual(fixture.events, ['stage input', ...profile[4].map(slotId => `reserve ${slotId}`),
		'release input file', 'run worker', 'release job']);
	await assert.rejects(stat(fixture.inputPath), { code: 'ENOENT' });
});

test('Advanced releases disk audio when output storage preflight fails before staging', async context => {
	const fixture = await diskReviewFixture(context, CASES[0], { failPreflight: true });
	await fixture.store.run();
	const { phase, error } = fixture.store.getSnapshot();
	assert.equal(phase, 'error');
	assert.equal(error, 'Test storage preflight failed.');
	assert.deepEqual(fixture.events.filter(event => event !== 'release job'), ['release input file']);
	await assert.rejects(stat(fixture.inputPath), { code: 'ENOENT' });
});

test('Advanced still rejects output geometry different from its released input', async context => {
	const fixture = await diskReviewFixture(context, CASES[0], { outputFrameCount: FRAME_COUNT - 1 });
	await fixture.store.run();
	const { phase, error, result } = fixture.store.getSnapshot();
	assert.equal(phase, 'error');
	assert.match(error ?? '', /geometry|frame count/iu);
	assert.equal(result, null);
	assert.equal(fixture.events.filter(event => event === 'run worker').length, 1);
	await assert.rejects(stat(fixture.inputPath), { code: 'ENOENT' });
});

async function diskReviewFixture(context: TestContext, profile: typeof CASES[number], options: Readonly<{
	failPreflight?: boolean;
	outputFrameCount?: number;
}> = {}) {
	const [operation, modelId, version, sampleRate, slots] = profile;
	const directory = await mkdtemp(join(tmpdir(), 'advanced-model-review.'));
	context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	const inputPath = join(directory, 'in.wav');
	const body = await diskWave(inputPath, sampleRate, FRAME_COUNT);
	const output = await diskWave(join(directory, 'out.wav'), sampleRate, options.outputFrameCount ?? FRAME_COUNT);
	assert.ok(body.size > 32 * 1024 * 1024);
	const sourceEndFrame = Math.round(FRAME_COUNT * PROJECT_RATE / sampleRate);
	const events: string[] = [];
	bindLocalAssistancePreparedAudioWaveRelease(body, async () => {
		events.push('release input file');
		await unlink(inputPath);
	});
	const sourceId = 'source-a';
	const project = Object.freeze({ id: 'advanced-disk-review', schemaFamily: 'soundscaper' as const, schemaVersion: 1,
		revision: 4, sampleRate: PROJECT_RATE, assistanceAssets: Object.freeze([]),
		clips: Object.freeze([{ id: 'clip-a', kind: 'audio', sourceId, sequenceId: 'sequence-main',
			avLinkId: null, reversed: false, speedRatio: 1, pitchCents: 0, stretchToTempo: false,
			warpMap: null, timelineStartFrame: 0, durationFrames: sourceEndFrame,
			sourceStartFrame: 0, sourceDurationFrames: sourceEndFrame }]),
		sources: Object.freeze([{ id: sourceId, kind: 'audio', contentSha256: SOURCE_SHA256, sampleRate: PROJECT_RATE }]),
	});
	const selectionFence = Object.freeze({ projectId: project.id, schemaFamily: project.schemaFamily,
		schemaVersion: project.schemaVersion, revision: project.revision, sequenceId: 'sequence-main',
		occurrenceIds: Object.freeze(['clip-a']), sourceId, sourceSha256: SOURCE_SHA256,
		sourceStartFrame: 0, sourceEndFrame, linkMembershipSha256: '2b'.repeat(32), timingAuthoritySha256: '3c'.repeat(32) });
	const role: LocalAssistancePreparedOutput['role'] = operation === 'source-separation' ? 'separated-audio' : 'enhanced-audio';
	const prepared: LocalAssistancePreparedMedia = { sourceId, operation, selectionFence,
		inputs: [{ role: 'audio', mediaType: 'audio/wav', bytes: body }],
		outputs: slots.map(slotId => ({ slotId, role, mediaType: 'audio/wav', maximumByteLength: body.size })),
	};
	const prepareSelectedMedia = async () => prepared;
	const advanced = createLocalAssistanceAdvancedWorkflowPreparation({
		getProject: () => project, captureProject: () => project, assertProject: token => assert.equal(token, project),
		preflightStorage: async () => {
			if (options.failPreflight) throw new Error('Test storage preflight failed.');
		},
		selected: { prepareSelectedMedia },
	});
	let ordinal = 0;
	const workflow = resolveLocalAssistanceWorkflowBridge({
		createJob: async () => ({ contractVersion: 1, jobId: JOB_ID }),
		run: async (request: AssistanceWorkflowV1) => {
			events.push('run worker');
			await assert.rejects(stat(inputPath), { code: 'ENOENT' });
			return { contractVersion: 1, jobId: JOB_ID, workflowId: request.workflowId, outcome: 'completed',
				result: { contractVersion: 1, jobId: JOB_ID, workflowId: request.workflowId,
					stageIds: request.stageIds, outputs: request.outputs } };
		},
		cancel: async () => ({ contractVersion: 1, jobId: JOB_ID, outcome: 'cancelled' }),
		onProgress: () => () => undefined, readOutput: async () => output,
		custody: {
			async stageInput(request: StagedInput) {
				events.push('stage input');
				assert.equal(request.byteLength, body.size);
				assert.equal((await inspectWavBlobPcm(request.bytes)).frameCount, FRAME_COUNT);
				const { jobId, workflowId, stageId, slotId, byteLength, sha256 } = request;
				return custodyHandle({ jobId, workflowId, stageId, slotId, direction: 'input', byteLength, sha256,
					maximumByteLength: null }, ++ordinal);
			},
			async reserveOutput(request: OutputReservation) {
				events.push(`reserve ${request.slotId}`);
				return custodyHandle({ ...request, direction: 'output', byteLength: null, sha256: null }, ++ordinal);
			},
			async bindProducer() { throw new Error('Advanced has no producer stages.'); },
			async release() { events.push('release job'); return true; },
		},
	});
	assert.ok(workflow);
	const store = createLocalAssistanceAdvancedWorkflowSessionStore({
		bridge: { workflow, models: async () => [{ modelId, version, task: operation,
			artifactSha256s: ['5e'.repeat(32)] }] },
		preparation: { ...advanced, prepareSelectedMedia,
			listSelectedMedia: async () => ({ sources: [{ sourceId, label: 'Discussion', mediaKind: 'audio',
				operations: [operation] }] }) },
	});
	context.after(() => store.dispose());
	await store.load();
	store.selectSource(sourceId);
	store.selectOperation(operation);
	store.selectModel(modelId);
	assert.equal(store.getSnapshot().canRun, true);
	return { store, events, inputPath };
}

async function diskWave(path: string, sampleRate: number, frameCount: number): Promise<Blob> {
	const header = createWavHeader({ sampleRate, channelCount: 2, totalFrames: frameCount, bitDepth: 32, float: true });
	const file = await open(path, 'wx');
	try {
		await file.writeFile(header);
		await file.truncate(header.byteLength + frameCount * 8);
	} finally { await file.close(); }
	return openAsBlob(path, { type: 'audio/wav' });
}

type StagedInput = Omit<Parameters<LocalAssistanceWorkflowCustodyBridge['stageInput']>[0], 'signal'>
	& Readonly<{ byteLength: number; sha256: string }>;
type OutputReservation = Parameters<LocalAssistanceWorkflowCustodyBridge['reserveOutput']>[0];
type CustodyGeometry = Omit<Parameters<typeof createAssistanceWorkflowCustodyClaimV1>[0], 'custodyVersion' | 'claimId'>;

function custodyHandle(geometry: CustodyGeometry, ordinal: number) {
	const custody = createAssistanceWorkflowCustodyClaimV1({ ...geometry, custodyVersion: 1,
		claimId: ordinal.toString(16).padStart(40, '0') });
	return { custody, workflowClaim: workflowClaimFromCustodyV1(custody) };
}
