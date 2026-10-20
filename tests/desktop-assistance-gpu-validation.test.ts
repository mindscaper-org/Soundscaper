/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	currentAssistanceGpuValidationJob,
	isAssistanceGpuValidationEnabled,
	recordAssistanceGpuValidation,
	withAssistanceGpuValidationJob,
} from '../desktop/assistance-gpu-validation.ts';

const keys = ['SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS', 'SOUNDSCAPER_ASSISTANCE_GPU_VALIDATION',
	'SOUNDSCAPER_ASSISTANCE_GPU_EVIDENCE_ROOT'] as const;
const job = { jobId: 'model-job-1', familyId: 'onnxruntime-node', modelIds: ['transnetv2'] };
const proof = { provider: 'webgpu' as const, proof: 'onnx-profile' as const,
	gpuWorkCount: 12, cpuWorkCount: 2 };

async function fixture(run: (directory: string) => Promise<void>): Promise<void> {
	const previous = keys.map(key => process.env[key]);
	const directory = await mkdtemp(join(tmpdir(), 'scape-gpu-evidence-test-'));
	process.env.SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS = '1';
	process.env.SOUNDSCAPER_ASSISTANCE_GPU_VALIDATION = '1';
	process.env.SOUNDSCAPER_ASSISTANCE_GPU_EVIDENCE_ROOT = directory;
	try { await run(directory); }
	finally {
		keys.forEach((key, index) => {
			const value = previous[index];
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		});
		await rm(directory, { recursive: true, force: true });
	}
}

test('GPU diagnostics require both trusted test flags and an absolute evidence directory', async () => {
	await fixture(async () => {
		assert.equal(isAssistanceGpuValidationEnabled(), true);
		process.env.SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS = '0';
		assert.equal(isAssistanceGpuValidationEnabled(), false);
		await recordAssistanceGpuValidation(proof);
		process.env.SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS = '1';
		process.env.SOUNDSCAPER_ASSISTANCE_GPU_EVIDENCE_ROOT = 'relative';
		assert.throws(isAssistanceGpuValidationEnabled, /absolute/u);
	});
});

test('GPU evidence binds completed work to the current authenticated job without leaking concurrent contexts', async () => {
	await fixture(async directory => {
		assert.equal(currentAssistanceGpuValidationJob(), undefined);
		await Promise.all([job, { ...job, jobId: 'model-job-2', modelIds: ['silero-vad'] }].map(async entry =>
			withAssistanceGpuValidationJob(entry, async () => {
				await Promise.resolve();
				assert.deepEqual(currentAssistanceGpuValidationJob(), entry);
				await recordAssistanceGpuValidation(proof);
				await recordAssistanceGpuValidation(proof);
			})));
		assert.equal(currentAssistanceGpuValidationJob(), undefined);
		const files = await readdir(directory);
		assert.equal(files.length, 4);
		const records = await Promise.all(files.map(async file => JSON.parse(await readFile(join(directory, file), 'utf8')) as unknown));
		for (const entry of [job, { ...job, jobId: 'model-job-2', modelIds: ['silero-vad'] }]) {
			assert.equal(records.filter(record => JSON.stringify(record) === JSON.stringify({ schemaVersion: 1, ...entry, ...proof })).length, 2);
		}
	});
});

test('GPU evidence rejects unbound, CPU, empty, and nonfinite work rather than manufacturing proof', async () => {
	await fixture(async directory => {
		await assert.rejects(recordAssistanceGpuValidation(proof), /job/u);
		await withAssistanceGpuValidationJob(job, async () => {
			for (const invalid of [{ ...proof, gpuWorkCount: 0 }, { ...proof, cpuWorkCount: NaN },
				{ ...proof, provider: 'cpu' }, { ...proof, deviceName: 'x'.repeat(257) },
				{ ...proof, processIds: [0] }, { ...proof, processIds: [12, 12] },
				{ ...proof, processIds: [NaN] }, { ...proof, processIds: Array.from({ length: 33 }, (_, i) => i + 1) }]) {
				await assert.rejects(recordAssistanceGpuValidation(invalid as typeof proof), /GPU evidence/u);
			}
		});
		assert.deepEqual(await readdir(directory), []);
		await assert.rejects(withAssistanceGpuValidationJob({ ...job, jobId: '../escape' }, async () => {}), /job/u);
	});
});

test('GPU evidence retains observed native process IDs for physical adapter correlation', async () => {
	await fixture(async directory => {
		await withAssistanceGpuValidationJob(job, async () =>
			recordAssistanceGpuValidation({ ...proof, processIds: [4312] }));
		const [file] = await readdir(directory);
		const receipt = JSON.parse(await readFile(join(directory, file!), 'utf8')) as Record<string, unknown>;
		assert.deepEqual(receipt.processIds, [4312]);
	});
});

test('GPU evidence refuses a symbolic-link destination', async () => {
	await fixture(async directory => {
		const link = `${directory}-link`;
		await symlink(directory, link, 'dir');
		process.env.SOUNDSCAPER_ASSISTANCE_GPU_EVIDENCE_ROOT = link;
		try {
			await withAssistanceGpuValidationJob(job, async () =>
				assert.rejects(recordAssistanceGpuValidation(proof), /directory/u));
			assert.deepEqual(await readdir(directory), []);
		} finally { await rm(link, { force: true }); }
	});
});
