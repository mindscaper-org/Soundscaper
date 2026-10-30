/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	CORRIDORKEY_GRAPH_ARTIFACTS_V1,
	assertCorridorKeyModelArtifactsV1,
	assertCorridorKeyModelBindingV1,
} from '../desktop/assistance-corridorkey-model.ts';
import { validateAssistanceOperationRequest } from '../desktop/assistance-operation-contract.ts';
import { isAssistanceRuntimeFamilyOperationRequest } from '../desktop/assistance-operation-family-execution.ts';
import { assistanceRuntimeFamiliesForModel } from '../desktop/assistance-runtime-model-supply.ts';
import { assistanceRuntimeFamilyTaskAdmitted } from '../desktop/assistance-runtime-family-job-contract.ts';
import { AssistanceStagingRegistry } from '../desktop/assistance-staging-registry.ts';
import { createAssistanceOperationService, type AssistanceOperationServiceOptions } from '../desktop/assistance-operation-service.ts';

import { CORRIDORKEY_CHROMA_HINT_DEFAULTS } from '../src/common/editor/assistance/corridorkey-hint-settings.ts';

const JOB_ID = '1'.repeat(40);
const MIME = 'application/vnd.soundscaper.frame-pack';

function binding() {
	return { modelId: 'corridorkey-2.0', version: '2.0.0',
		artifactSha256s: CORRIDORKEY_GRAPH_ARTIFACTS_V1.map(({ sha256 }) => sha256).sort() };
}

function request() {
	return { contractVersion: 1, jobId: JOB_ID, operation: 'video-keying',
		selectionFence: { projectId: 'project', schemaFamily: 'framescaper', schemaVersion: 1,
			revision: 1, sequenceId: 'sequence', occurrenceIds: ['clip'], sourceId: 'source',
			sourceSha256: '1'.repeat(64), sourceStartFrame: 0, sourceEndFrame: 2,
			linkMembershipSha256: '2'.repeat(64), timingAuthoritySha256: '3'.repeat(64) },
		models: [binding()],
		inputs: [2, 3].map(value => ({ claimVersion: 1, jobId: JOB_ID, claimId: String(value).repeat(40),
			role: 'frame-pack', mediaType: MIME, byteLength: 128, sha256: 'a'.repeat(64) })),
		outputs: [4, 5].map(value => ({ claimVersion: 1, jobId: JOB_ID, claimId: String(value).repeat(40),
			role: 'keyed-frames', mediaType: MIME, maximumByteLength: 128 })),
	};
}

test('video keying admits matched frame packs and routes to the authenticated ONNX engine', () => {
	const admitted = validateAssistanceOperationRequest(request());
	assert.equal(admitted.operation, 'video-keying');
	assert.equal(isAssistanceRuntimeFamilyOperationRequest(admitted), true);
	assert.deepEqual(assistanceRuntimeFamiliesForModel('corridorkey-2.0', 'video-keying'), ['onnxruntime-node']);
	assert.equal(assistanceRuntimeFamilyTaskAdmitted('onnxruntime-node', 'video-keying'), true);
	assert.equal(assistanceRuntimeFamilyTaskAdmitted('llama-cpp', 'video-keying'), false);
});

test('video keying rejects unpaired output reservations, wrong roles, and aggregate byte overruns', () => {
	const value = request();
	assert.throws(() => validateAssistanceOperationRequest({ ...value, outputs: value.outputs.slice(1) }),
		/match|count|paired/iu);
	assert.throws(() => validateAssistanceOperationRequest({ ...value,
		outputs: value.outputs.map(output => ({ ...output, role: 'enhanced-audio' })) }), /role|media type/iu);
	assert.throws(() => validateAssistanceOperationRequest({ ...value,
		outputs: value.outputs.map(output => ({ ...output, role: 'keyed-video', mediaType: 'video/webm' })) }), /role/iu);
	assert.throws(() => validateAssistanceOperationRequest({ ...value,
		inputs: value.inputs.map(input => ({ ...input, byteLength: 5 * 1024 ** 3 })) }), /aggregate/iu);
});

test('CorridorKey execution pins exactly five measured standalone graph artifacts without sidecars', () => {
	assertCorridorKeyModelBindingV1(binding());
	assertCorridorKeyModelArtifactsV1(CORRIDORKEY_GRAPH_ARTIFACTS_V1);
	assert.deepEqual(CORRIDORKEY_GRAPH_ARTIFACTS_V1.map(({ fileName }) => fileName),
		['cradio.onnx', 'moge.onnx', 'rvm.onnx', 'stage1.onnx', 'stage2.onnx']);
	for (const replacement of [
		{ ...binding(), modelId: 'corridorkey-other' }, { ...binding(), version: '2.0.1' },
		{ ...binding(), artifactSha256s: binding().artifactSha256s.slice(1) },
		{ ...binding(), artifactSha256s: ['0'.repeat(64), ...binding().artifactSha256s.slice(1)] },
	]) assert.throws(() => assertCorridorKeyModelBindingV1(replacement), /exact|pinned/iu);
	const artifacts = CORRIDORKEY_GRAPH_ARTIFACTS_V1.map(artifact => ({ ...artifact }));
	assert.throws(() => assertCorridorKeyModelArtifactsV1(artifacts.slice(1)), /exact|inventory/iu);
	assert.throws(() => assertCorridorKeyModelArtifactsV1([
		...artifacts, { fileName: 'stage1.onnx.data', byteLength: 1, sha256: 'a'.repeat(64) },
	]), /exact|inventory/iu);
	assert.throws(() => assertCorridorKeyModelArtifactsV1([
		{ ...artifacts[0]!, byteLength: 1 }, ...artifacts.slice(1),
	]), /exact|pinned/iu);
});

test('the operation service resolves five exact graph roles and authenticates every paired output', async context => {
	const root = await mkdtemp(join(tmpdir(), 'corridorkey-operation-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const registry = new AssistanceStagingRegistry({ root: join(root, 'staging') });
	const artifacts = CORRIDORKEY_GRAPH_ARTIFACTS_V1;
	const models: AssistanceOperationServiceOptions['models'] = {
		status: async () => ({ runtimeAvailable: true, runtimeReason: null, models: [{
			modelId: 'corridorkey-2.0', version: '2.0.0', task: 'video-keying', availability: 'installed',
			downloadBytes: 5, installedBytes: 5, attributionRequired: true,
		}] }),
		listInstalled: async () => [{ modelId: 'corridorkey-2.0', version: '2.0.0',
			totalBytes: artifacts.reduce((sum, artifact) => sum + artifact.byteLength, 0), artifacts }],
		resolveModelPaths: async () => Object.fromEntries(artifacts.map(artifact =>
			[artifact.role, join(root, artifact.fileName)])),
	};
	let calls = 0;
	const service = createAssistanceOperationService({ registry, models,
		runtime: { status: async () => ({ available: false, reason: 'unused', moduleId: 'unused' }),
			recognize: async () => { throw new Error('Speech runtime must not receive keying'); } },
		additionalRuntime: { run: async selected => {
			calls += 1;
			assert.equal(selected.task, 'video-keying');
			assert.deepEqual(selected.settings.hint, CORRIDORKEY_CHROMA_HINT_DEFAULTS);
			assert.deepEqual(selected.models.map(model => model.artifactRole), artifacts.map(artifact => artifact.role));
			const outputs = await Promise.all(selected.outputs.map(async output => {
				const body = Buffer.alloc(output.reservation.maximumByteLength, 7);
				await writeFile(output.path, body);
				return { claimId: output.reservation.claimId, role: output.reservation.role,
					mediaType: output.reservation.mediaType, byteLength: body.length,
					sha256: createHash('sha256').update(body).digest('hex') };
			}));
			return { outcome: 'completed', outputs };
		} },
	});
	const { jobId } = await service.createJob();
	const inputs = [];
	const outputs = [];
	for (const byteLength of [128, 160]) {
		async function* bytes() { yield new Uint8Array(byteLength); }
		inputs.push(await service.stageInput({ jobId, role: 'frame-pack', mediaType: MIME,
			byteLength, bytes: bytes() }));
		outputs.push(await service.reserveOutput({ jobId, role: 'keyed-frames', mediaType: MIME,
			maximumByteLength: byteLength }));
	}
	const result = await service.run({ ...request(), jobId, inputs, outputs, settings: CORRIDORKEY_CHROMA_HINT_DEFAULTS });
	assert.equal(result.outcome, 'completed');
	if (result.outcome !== 'completed') throw new Error('Expected authenticated keying completion');
	assert.equal(result.result.outputs.length, 2);
	for (const claim of result.result.outputs) {
		assert.equal((await service.openOutput({ jobId, claim })).binding.sha256, claim.sha256);
	}
	assert.equal(calls, 1);
	await service.release(jobId);
});

test('keying accepts only closed normal-keyer hint settings and snapshots the controls', () => {
	const settings = { ...CORRIDORKEY_CHROMA_HINT_DEFAULTS };
	const admitted = validateAssistanceOperationRequest({ ...request(), settings });
	assert.equal(admitted.operation, 'video-keying');
	assert.deepEqual(admitted.settings, settings);
	assert.ok(Object.isFrozen(admitted.settings));
	settings.keyColor = 0x0000ff;
	assert.deepEqual(admitted.settings, CORRIDORKEY_CHROMA_HINT_DEFAULTS);
	for (const settings of [{ ...CORRIDORKEY_CHROMA_HINT_DEFAULTS, path: '/tmp/matte' },
		{ ...CORRIDORKEY_CHROMA_HINT_DEFAULTS, hintQuality: NaN }, { settingsVersion: 1, hintMode: 'external' }]) {
		assert.throws(() => validateAssistanceOperationRequest({ ...request(), settings }), /hint|settings|finite/iu);
	}
});
