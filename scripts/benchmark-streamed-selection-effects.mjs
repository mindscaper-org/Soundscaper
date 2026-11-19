/* SPDX-License-Identifier: AGPL-3.0-only */
import { performance } from 'node:perf_hooks';
import { runStreamedSelectionProcessing } from '../src/common/editor/streamed-effects/processing.ts';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects.js';
import { initializePffft } from '../src/common/editor/pffft.js';

// Kernel/packet benchmark, deliberately separate from browser decode and storage.
// node --import tsx scripts/benchmark-streamed-selection-effects.mjs
// node --import tsx scripts/benchmark-streamed-selection-effects.mjs --memory=stream --minutes=45
// Run memory variants in separate processes; --memory=whole needs about 2 GiB at 45 minutes.
const memory = process.argv.find(value => value.startsWith('--memory='))?.split('=')[1];
const minutes = Number(process.argv.find(value => value.startsWith('--minutes='))?.split('=')[1] ?? 45);
const rate = 48000, chunkFrames = 65536;
function signal(frames) {
	return Array.from({ length: 2 }, (_, c) => Float32Array.from({ length: frames }, (_, f) => .2 * Math.sin(f * (.037 + c * .013))));
}
const cases = [
	['highpass-filter', { frequency: 80, rolloff: 24 }],
	['audacity-classic-filters', { family: 'chebyshev-ii', direction: 'highpass', order: 7, cutoffHz: 1200 }],
	['audacity-compressor', { lookaheadMs: 10, thresholdDb: -20, attackMs: 20 }],
	['audacity-filter-curve-eq', { filterLength: 8191, points: [{ frequency: 20, gain: 6 }, { frequency: 20000, gain: -6 }] }],
];
await initializePffft();
if (memory) {
	if (!['stream', 'whole'].includes(memory) || !Number.isFinite(minutes) || minutes <= 0 || minutes > 60) throw new RangeError('Use --memory=stream|whole and 0 < --minutes <= 60.');
	const frames = Math.round(minutes * 60 * rate), pattern = signal(chunkFrames);
	const [type, params] = cases[0]; let checksum = 0;
	const start = performance.now();
	if (memory === 'whole') {
		const input = pattern.map(template => {
			const channel = new Float32Array(frames);
			for (let offset = 0; offset < frames; offset += chunkFrames) channel.set(template.subarray(0, Math.min(chunkFrames, frames - offset)), offset);
			return channel;
		});
		const output = await applyAudioSelectionEffectAsync(type, input, rate, params);
		for (let offset = 0; offset < frames; offset += chunkFrames) for (const channel of output) checksum += channel[offset];
	} else {
		await runStreamedSelectionProcessing({ effects: [{ type, params }], frameCount: frames, sampleRate: rate, channelCount: 2 }, {
			assertCurrent: () => undefined, yieldToMainThread: false,
			read: async (start, end) => pattern.map(channel => channel.subarray(0, end - start)),
			write: async channels => { for (const channel of channels) checksum += channel[0]; },
		});
	}
	console.log(JSON.stringify({ mode: memory, minutes, elapsedMs: Math.round(performance.now() - start), peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024), checksum,
		includes: 'DSP and packet handling; whole also allocates input; excludes browser rendering and storage' }));
} else {
	const seconds = 30, frames = rate * seconds, input = signal(frames);
	for (const [type, params] of cases) {
		const medianMs = {};
		for (const mode of ['whole', 'stream']) {
			const times = [];
			for (let run = 0; run < 4; run++) {
				const start = performance.now();
				if (mode === 'whole') await applyAudioSelectionEffectAsync(type, input, rate, params);
				else await runStreamedSelectionProcessing({ effects: [{ type, params }], frameCount: frames, sampleRate: rate, channelCount: 2 }, {
					assertCurrent: () => undefined, yieldToMainThread: false, read: async (start, end) => input.map(channel => channel.subarray(start, end)), write: async () => undefined,
				});
				if (run) times.push(performance.now() - start);
			}
			medianMs[mode] = Math.round(times.sort((a, b) => a - b)[1]);
		}
		console.log(JSON.stringify({ type, seconds, sampleRate: rate, channels: 2, medianMs }));
	}
}
