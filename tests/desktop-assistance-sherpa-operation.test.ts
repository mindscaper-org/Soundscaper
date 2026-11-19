/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createAssistanceOperationService } from '../desktop/assistance-operation-service.ts';
import { AssistanceStagingRegistry } from '../desktop/assistance-staging-registry.ts';
import { SHERPA_ENHANCEMENT_ARTIFACTS } from '../desktop/assistance-sherpa-enhancement-contract.ts';
import type { SherpaEnhancementRequest } from '../desktop/assistance-sherpa-enhancement-capture.ts';
import { createWavHeader } from '../src/common/editor/wav.js';

test('the main operation route gives Sherpa exact model, input and output custody and reauthenticates its WAV', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'sherpa-operation-'));
	context.after(async () => { await service.dispose(); await rm(root, { recursive: true, force: true }); });
	const pin = SHERPA_ENHANCEMENT_ARTIFACTS.gtcrn[0];
	const requests: SherpaEnhancementRequest[] = [];
	const body = Buffer.concat([Buffer.from(createWavHeader({ sampleRate: 48_000,
		channelCount: 1, totalFrames: 8, bitDepth: 32, float: true })), Buffer.alloc(32)]);
	const registry = new AssistanceStagingRegistry({ root: join(root, 'jobs') });
	const service = createAssistanceOperationService({ registry,
		runtime: { status: async () => ({ available: false, reason: 'not used', moduleId: 'sherpa-onnx-node' }),
			recognize: async () => { throw new Error('Recognition must not run'); } },
		additionalRuntime: { run: async () => { throw new Error('Generic ONNX must not run'); } },
		models: { status: async () => ({ runtimeAvailable: true, runtimeReason: null,
			models: [{ modelId: 'gtcrn', version: '1.0.0', task: 'speech-enhancement',
				availability: 'installed' as const, downloadBytes: 1, installedBytes: 1, attributionRequired: true }] }),
			listInstalled: async () => [{ modelId: 'gtcrn', version: '1.0.0', totalBytes: 1,
				artifacts: [{ fileName: 'gtcrn_simple.onnx', byteLength: 1, sha256: pin.sha256 }] }],
			resolveModelPaths: async () => ({ gtcrn_simple: '/models/verified-gtcrn' }) },
		enhancementRuntime: { status: async () => ({ available: true, reason: null, moduleId: 'sherpa-onnx-node' }),
			enhance: async (request) => { requests.push(request); assert.deepEqual(await readFile(request.input.path), body);
				await writeFile(request.output.path, body);
				return { byteLength: body.length, sha256: createHash('sha256').update(body).digest('hex') }; } },
	});
	const { jobId } = await service.createJob();
	const input = await service.stageInput({ jobId, role: 'audio', mediaType: 'audio/wav', byteLength: body.length,
		bytes: (async function* () { yield body; })() });
	const output = await service.reserveOutput({ jobId, role: 'enhanced-audio', mediaType: 'audio/wav', maximumByteLength: body.length });
	const outcome = await service.run({ contractVersion: 1, jobId, operation: 'speech-enhancement',
		selectionFence: { projectId: 'project-1', schemaFamily: 'soundscaper', schemaVersion: 1, revision: 0,
			sequenceId: 'sequence-1', occurrenceIds: ['occurrence-1'], sourceId: 'source-1', sourceSha256: 'a'.repeat(64),
			sourceStartFrame: 0, sourceEndFrame: 8, linkMembershipSha256: 'b'.repeat(64), timingAuthoritySha256: 'c'.repeat(64) },
		models: [{ modelId: 'gtcrn', version: '1.0.0', artifactSha256s: [pin.sha256] }], inputs: [input], outputs: [output] });
	assert.equal(outcome.outcome, 'completed'); assert.equal(requests.length, 1);
	assert.equal(requests[0]!.jobId, jobId); assert.equal(requests[0]!.modelId, 'gtcrn');
	assert.deepEqual(requests[0]!.models, [{ modelId: 'gtcrn', version: '1.0.0', artifactRole: 'gtcrn_simple',
		path: '/models/verified-gtcrn', byteLength: 1, sha256: pin.sha256 }]);
	if (outcome.outcome !== 'completed') throw new Error('Expected completion');
	assert.equal(outcome.result.outputs[0]!.sha256, createHash('sha256').update(body).digest('hex'));
});
