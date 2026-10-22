/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { withAssistanceGpuValidationJob } from '../desktop/assistance-gpu-validation.ts';
import { runAssistanceKokoroGpuValidationV1 } from '../desktop/assistance-kokoro-g2p-gpu-validation.ts';

const files = ['libscape-g2p-gpu.so', 'libonnxruntime_providers_webgpu.so', 'onnx-webgpu-device-probe']
	.map(name => ({ path: `_internal/scape-gpu/${name}` }));
const job = { jobId: 'a'.repeat(40), familyId: 'onnxruntime-node', modelIds: ['kokoro-82m-v1.0'] };

async function strict(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'scape-g2p-gpu-evidence-'));
	for (const [key, value] of Object.entries({ SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS: '1',
		SOUNDSCAPER_ASSISTANCE_GPU_VALIDATION: '1', SOUNDSCAPER_ASSISTANCE_GPU_EVIDENCE_ROOT: root })) {
		const old = process.env[key];
		process.env[key] = value;
		t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
	}
	t.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

test('strict English G2P fails before launching a CPU-only authenticated runtime', async t => {
	await strict(t);
	let launched = false;
	await assert.rejects(withAssistanceGpuValidationJob(job, () => runAssistanceKokoroGpuValidationV1(
		'a', 'linux-x64', [], async () => { launched = true; return new Uint8Array(); },
	)), /GPU Kokoro pronunciation runtime/u);
	assert.equal(launched, false);
});

test('strict English G2P binds observed native MatMul kernels to the pronunciation family', async t => {
	const root = await strict(t);
	const output = Uint8Array.of(1, 2, 3);
	const actual = await withAssistanceGpuValidationJob(job, () => runAssistanceKokoroGpuValidationV1(
		'a', 'linux-x64', files, async environment => {
			assert.equal(environment?.SCAPE_KOKORO_REQUIRE_GPU, '1');
			await writeFile(`${environment!.SCAPE_KOKORO_GPU_PROFILE_PREFIX}_trace.json`, JSON.stringify([
				{ cat: 'Node', ph: 'X', name: 'g2p-gemm_kernel_time', dur: 50, pid: 12345,
					args: { provider: 'WebGpuExecutionProvider' } },
			]));
			return output;
		},
	));
	assert.equal(actual, output);
	const names = await readdir(root);
	assert.equal(names.length, 1);
	const receipt = JSON.parse(await readFile(join(root, names[0]!), 'utf8')) as Record<string, unknown>;
	assert.equal(receipt.familyId, 'kokoro-g2p');
	assert.equal(receipt.jobId, job.jobId);
	assert.equal(receipt.gpuWorkCount, 1);
	assert.equal(receipt.cpuWorkCount, 0);
	assert.deepEqual(receipt.processIds, [12345]);
});

test('strict G2P rejects absent native trace and leaves deterministic languages to the synthesis GPU proof', async t => {
	await strict(t);
	await assert.rejects(withAssistanceGpuValidationJob(job, () => runAssistanceKokoroGpuValidationV1(
		'b', 'linux-x64', files, async () => new Uint8Array(),
	)), /profile/u);
	const output = Uint8Array.of(7);
	assert.equal(await runAssistanceKokoroGpuValidationV1('j', 'linux-x64', [], async environment => {
		assert.equal(environment, undefined);
		return output;
	}), output);
});
