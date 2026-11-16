/* SPDX-License-Identifier: AGPL-3.0-only */
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { MidiDemandSource } from '../../src/common/editor/engine/midi-demand-source.ts';
import { openThreadedMidiRenderer } from '../../src/common/editor/engine/midi-threaded-renderer.ts';
import { NodeMidiWorker } from '../../tests/helpers/node-midi-worker.ts';

const sampleRate = 48000, blockFrames = 1024;
const results = [];
for (const voices of [1, 32, 128]) {
	const data = { version: 1 as const, notes: Array.from({ length: voices }, (_, index) => ({
		id: String(index), pitch: 36 + index % 72, velocity: 80, channel: index % 16, startFrame: 0, durationFrames: sampleRate * 3600,
	})) };
	const source = new MidiDemandSource({ frameCount: sampleRate * 3600, channelCount: 1, chunkFrames: blockFrames },
		() => openThreadedMidiRenderer(data, 'triangle', sampleRate, () => new NodeMidiWorker()));
	const delay = monitorEventLoopDelay({ resolution: 1 }); delay.enable();
	const first = performance.now(); await source.chunk(0); const coldMs = performance.now() - first;
	const timings = [];
	for (let index = 1; index < 200; index++) { const start = performance.now(); await source.chunk(index); timings.push(performance.now() - start); }
	const cached = performance.now();
	for (let index = 0; index < 200; index++) await source.chunk(index);
	const cachedMs = (performance.now() - cached) / 200;
	const seek = performance.now(); await source.chunk(48000); const coldSeekMs = performance.now() - seek;
	delay.disable(); timings.sort((left, right) => left - right);
	results.push({ voices, coldMs, p50Ms: timings[Math.floor(timings.length * 0.5)], p95Ms: timings[Math.floor(timings.length * 0.95)],
		cachedMs, coldSeekMs, uiEventLoopP99Ms: delay.percentile(99) / 1e6, cachedBytes: source.cachedBytes });
	await source.close();
}
process.stdout.write(`${JSON.stringify({ cpu: cpus()[0]?.model, sampleRate, blockFrames, deadlineMs: blockFrames / sampleRate * 1000, results }, null, 2)}\n`);
