/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { executeSherpaEnhancement } from '../desktop/assistance-sherpa-enhancement-worker.ts';
import { validateSherpaEnhancementGrant, validateSherpaEnhancementResult,
	SHERPA_ENHANCEMENT_ARTIFACTS } from '../desktop/assistance-sherpa-enhancement-contract.ts';
import { nativeChildFileIdentityFromStat } from '../desktop/native-child-file-identity.ts';
import { helperJobGrantResourceUsage } from '../desktop/helper-job-grant.ts';
import { createWavHeader } from '../src/common/editor/wav.js';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function fixture(context: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'sherpa-effect-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const frames = 15_361;
	const pcm = Float32Array.from({ length: frames * 2 }, (_, index) => index % 2 === 0 ? 0.125 : -0.25);
	const header = createWavHeader({ sampleRate: 48_000, channelCount: 2, totalFrames: frames, bitDepth: 32, float: true });
	const input = Buffer.concat([Buffer.from(header), Buffer.from(pcm.buffer)]);
	await writeFile(join(root, 'input.wav'), input); await writeFile(join(root, 'output.wav'), '');
	await writeFile(join(root, 'model.onnx'), 'fixture');
	const identity = async (path: string) => nativeChildFileIdentityFromStat(await lstat(path, { bigint: true }));
	const pin = SHERPA_ENHANCEMENT_ARTIFACTS['dpdfnet2-48khz'][0];
	const grant = validateSherpaEnhancementGrant({ operation: 'enhance-speech', moduleId: 'sherpa-onnx-node',
		jobId: 'a'.repeat(40), modelId: 'dpdfnet2-48khz',
		input: { claimId: 'b'.repeat(40), role: 'audio', mediaType: 'audio/wav', path: join(root, 'input.wav'),
			byteLength: input.length, sha256: digest(input), identity: await identity(join(root, 'input.wav')) },
		models: [{ modelId: 'dpdfnet2-48khz', version: '1.0.0', artifactRole: pin.role,
			path: join(root, 'model.onnx'), byteLength: 7, sha256: pin.sha256, identity: await identity(join(root, 'model.onnx')) }],
		output: { claimId: 'c'.repeat(40), role: 'enhanced-audio', mediaType: 'audio/wav', path: join(root, 'output.wav'),
			maximumByteLength: input.length, initialByteLength: 0, initialSha256: digest(Buffer.alloc(0)),
			identity: await identity(join(root, 'output.wav')) } });
	return { grant, pcm, frames };
}

interface Config { model: { provider: string; dpdfnet: { model: string } }; }
const authenticatedFixture = async (): Promise<void> => {};

test('streaming enhancement preserves stereo planes, partial final chunks and exact 48 kHz duration', async (context) => {
	const { grant, pcm } = await fixture(context); let released = 0;
	const configurations: Config[] = [];
	class Denoiser {
		readonly sampleRate = 48_000;
		constructor(config: Config) { configurations.push(config); }
		run({ samples, enableExternalBuffer }: { samples: Float32Array; enableExternalBuffer: boolean }) {
			assert.equal(enableExternalBuffer, false);
			return { samples: samples.map((sample) => sample / 2), sampleRate: this.sampleRate };
		}
		flush(external: boolean) { assert.equal(external, false); return { samples: new Float32Array(), sampleRate: this.sampleRate }; }
	}
	const result = await executeSherpaEnhancement(grant, { default: { OnlineSpeechDenoiser: Denoiser } }, {
		authenticateGrant: authenticatedFixture, executionProviders: ['webgpu', 'cpu'],
		disposeNativeResources: () => { released += 1; } });
	const bytes = await readFile(grant.output.path);
	assert.equal(result.byteLength, grant.input.byteLength); assert.equal(result.sha256, digest(bytes));
	const output = new Float32Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length));
	assert.deepEqual(output, pcm.map((sample) => sample / 2));
	assert.equal(released, 2); assert.equal(configurations.length, 2);
	assert.ok(configurations.every(({ model }) => model.provider === 'webgpu' && model.dpdfnet.model === grant.models[0]!.path));
});

test('native GPU construction failure cleans up before retrying the same channel on CPU', async (context) => {
	const { grant } = await fixture(context); let released = 0; const providers: string[] = [];
	class Denoiser {
		readonly sampleRate = 48_000;
		constructor({ model }: Config) { providers.push(model.provider); if (model.provider === 'webgpu') throw new Error('GPU unavailable');
			assert.ok(released >= 1); }
		run({ samples }: { samples: Float32Array }) { return { samples: samples.map((sample) => sample / 2), sampleRate: 48_000 }; }
		flush() { return { samples: new Float32Array(), sampleRate: 48_000 }; }
	}
	await executeSherpaEnhancement(grant, { OnlineSpeechDenoiser: Denoiser }, {
		authenticateGrant: authenticatedFixture, executionProviders: ['webgpu', 'cpu'],
		disposeNativeResources: () => { released += 1; } });
	assert.deepEqual(providers, ['webgpu', 'cpu', 'cpu']); assert.equal(released, 3);
});

test('model corruption stops before any native constructor runs', async (context) => {
	const { grant } = await fixture(context); let constructed = false;
	class Denoiser { constructor() { constructed = true; } }
	await assert.rejects(executeSherpaEnhancement(grant, { OnlineSpeechDenoiser: Denoiser }), /hash|digest/iu);
	assert.equal(constructed, false); assert.equal((await readFile(grant.output.path)).length, 0);
});

test('invalid audio cannot trigger CPU retries or publish an output', async (context) => {
	const { grant } = await fixture(context); let constructed = 0;
	class Denoiser {
		readonly sampleRate = 48_000;
		constructor() { constructed += 1; }
		run() { return { samples: Float32Array.of(Number.NaN), sampleRate: 48_000 }; }
	}
	await assert.rejects(executeSherpaEnhancement(grant, { OnlineSpeechDenoiser: Denoiser }, {
		authenticateGrant: authenticatedFixture, executionProviders: ['webgpu', 'cpu'] }), /invalid audio/iu);
	assert.equal(constructed, 1); assert.equal((await readFile(grant.output.path)).length, 0);
});

test('grants reject foreign models, role swaps, aliases, and over-reservation results', async (context) => {
	const { grant } = await fixture(context);
	for (const mutate of [
		(value: typeof grant) => { (value.models[0] as { sha256: string }).sha256 = '0'.repeat(64); },
		(value: typeof grant) => { (value.models[0] as { version: string }).version = 'other'; },
		(value: typeof grant) => { (value.input as { path: string }).path = value.output.path; },
	]) { const value = structuredClone(grant); mutate(value); assert.throws(() => validateSherpaEnhancementGrant(value), /exact|distinct/iu); }
	assert.throws(() => validateSherpaEnhancementResult({ byteLength: grant.output.maximumByteLength + 1, sha256: 'a'.repeat(64) }, grant), /invalid/iu);
	const usage = helperJobGrantResourceUsage('assistance-speech', grant);
	assert.equal(usage.outputBytes, grant.output.maximumByteLength);
	assert.equal(usage.scratchBytes, 2 * grant.output.maximumByteLength + 2 * 1024 ** 2);
});

test('a mid-stream GPU failure replays the same audio without duplicate samples or decreasing progress', async (context) => {
	const { grant, pcm } = await fixture(context); const progress: number[] = [];
	const providers: string[] = [];
	class Denoiser {
		readonly sampleRate = 48_000;
		readonly provider: string; calls = 0;
		constructor({ model }: Config) { this.provider = model.provider; providers.push(model.provider); }
		run({ samples }: { samples: Float32Array }) {
			this.calls += 1; if (this.provider === 'webgpu' && this.calls === 3) throw new Error('GPU execution failed');
			return { samples: samples.map((sample) => sample / 2), sampleRate: 48_000 };
		}
		flush() { return { samples: new Float32Array(), sampleRate: 48_000 }; }
	}
	await executeSherpaEnhancement(grant, { OnlineSpeechDenoiser: Denoiser }, {
		authenticateGrant: authenticatedFixture, executionProviders: ['webgpu', 'cpu'],
		onProgress: (value) => progress.push(value) });
	const bytes = await readFile(grant.output.path);
	assert.deepEqual(new Float32Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.length)), pcm.map((sample) => sample / 2));
	assert.deepEqual(providers, ['webgpu', 'cpu', 'cpu']);
	assert.equal(progress.at(-1), 1);
	assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]!));
});
