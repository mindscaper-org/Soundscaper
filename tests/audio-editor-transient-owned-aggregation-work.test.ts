/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { detectPcmTransients, planTransientAnalysisAdmission } from '../src/common/editor/transient-analysis.ts';
import { executeTransientAnalysisWorkerRequest } from '../src/common/editor/transient-analysis-worker-runtime.ts';

test('transferred worker PCM aggregates overlapping source frames once with exact detector output', (context) => {
	const frames = 96000, channelCount = 8;
	const channels = Array.from({ length: channelCount }, (_, channel) => Float32Array.from({ length: frames }, (_, frame) =>
		(frame % 24000 < 2000 ? 0.4 : 0.01) * Math.sin(frame * (0.013 + channel * 0.001) + channel)));
	const expected = detectPcmTransients(channels);
	const abs = Math.abs; let reads = 0;
	Object.defineProperty(Math, 'abs', { configurable: true, writable: true, value: (value: number) => { reads += 1; return abs(value); } });
	context.after(() => Object.defineProperty(Math, 'abs', { configurable: true, writable: true, value: abs }));
	const response = executeTransientAnalysisWorkerRequest({ type: 'transient-analysis/v1', requestId: 'owned-work', channels, options: {} });
	assert.equal(response.type, 'result');
	if (response.type !== 'result') throw new Error(response.error.message);
	assert.deepEqual(response.result, expected);
	assert.equal(reads, frames * channelCount);
	assert.ok(planTransientAnalysisAdmission(frames, {}, { channelCount, pcmCopyCount: 2 }).auxiliaryArrayBytes >= Math.ceil(frames / 256) * 24 + 1024 * 8);
});
