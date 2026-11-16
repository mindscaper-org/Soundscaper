/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { verifyAssistanceNativeRuntimePayload, assistanceNativeRuntimeTargetId } from '../desktop/assistance-native-runtime-payload.mjs';
import { authenticateAiDenoiseModel } from '../desktop/ai-denoise-model.ts';
import { createAiDenoiseKernel } from '../desktop/ai-denoise-kernel.ts';
import { AI_DENOISE_HOP, AI_DENOISE_LATENCY } from '../src/common/editor/first-party-effects/ai-denoise/contract.ts';

const { values } = parseArgs({ options: {
	'runtime-root': { type: 'string' }, manifest: { type: 'string' }, model: { type: 'string' },
	seconds: { type: 'string', default: '30' }, provider: { type: 'string', default: 'cpu' },
} });
if (!values['runtime-root'] || !values.manifest || !values.model) {
	throw new Error('Usage: node --import tsx scripts/benchmark-ai-denoising.mjs --runtime-root PATH --manifest PATH --model PATH [--seconds 30] [--provider cpu]');
}
const seconds = Number(values.seconds);
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw new RangeError('Benchmark duration must be 1–300 seconds of audio.');
if (values.provider !== 'cpu') throw new Error('This diagnostic measures the CPU baseline; GPU selection is exercised by the Electron integration test.');
const manifest = JSON.parse(await readFile(resolve(values.manifest), 'utf8'));
const verified = await verifyAssistanceNativeRuntimePayload({ manifest,
	targetId: assistanceNativeRuntimeTargetId({ platform: process.platform, arch: process.arch }), outputRoot: resolve(values['runtime-root']) });
if (verified.status !== 'built' || !verified.moduleSpecifier) throw new Error('An authenticated native runtime is required.');
await authenticateAiDenoiseModel(resolve(values.model));
const runtime = await import(verified.moduleSpecifier);
for (const channels of [1, 2]) {
	const kernel = await createAiDenoiseKernel(runtime, resolve(values.model), channels, {
		executionProviders: verified.executionProviders, ...(values.provider ? { provider: values.provider } : {}),
	});
	try {
		const timings = [], input = Array.from({ length: channels }, (_, c) => Float32Array.from({ length: AI_DENOISE_HOP },
			(_, i) => .1 * Math.sin((i + c * 11) * .137) + .02 * Math.cos(i * 2.17)));
		const output = input.map(() => new Float32Array(AI_DENOISE_HOP));
		let energy = 0;
		for (let sequence = 0; sequence < seconds * 100; sequence++) {
			const start = performance.now();
			const block = kernel.process({ type: 'block', slot: sequence % 16, sequence, input, output, outputFrames: 0 });
			timings.push(performance.now() - start);
			for (const plane of block.output) for (let i = 0; i < block.outputFrames; i++) energy += plane[i] ** 2;
		}
		timings.sort((a, b) => a - b);
		const elapsedMs = timings.reduce((a, b) => a + b, 0);
		console.log(JSON.stringify({ channels, audioSeconds: seconds, provider: kernel.metrics.provider,
			latencyFrames: AI_DENOISE_LATENCY, elapsedMs, realTimeFactor: elapsedMs / (seconds * 1000),
			p95Ms: timings[Math.ceil(timings.length * .95) - 1], p99Ms: timings[Math.ceil(timings.length * .99) - 1],
			maxMs: timings.at(-1), hopsOver10Ms: timings.filter(ms => ms >= 10).length, nonSilent: energy > 0,
			// This measures the production inference kernel; browser/IPC deadlines are separate checks.
			scope: 'authenticated-native-kernel' }));
	} finally { kernel.dispose(); }
}
