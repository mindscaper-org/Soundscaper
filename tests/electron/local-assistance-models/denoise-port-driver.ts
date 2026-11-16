/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

/** Find the shipped processor, so this regression cannot silently test a development rebuild. */
export async function packagedDenoisingWorklet(resourcesRoot: string,
	processorName: 'kw-ai-denoise' | 'kw-audio-render-capture' = 'kw-ai-denoise',
): Promise<string> {
	const assets = join(resourcesRoot, 'renderer/assets');
	const matches: string[] = [];
	for (const name of await readdir(assets)) {
		if (!name.endsWith('.js')) continue;
		const source = await readFile(join(assets, name), 'utf8');
		if (new RegExp(`registerProcessor\\(["']${processorName}["']`, 'u').test(source)) matches.push(name);
	}
	assert.equal(matches.length, 1, `the packaged renderer must contain exactly one ${processorName} processor`);
	return `/assets/${matches[0]!}`;
}

interface DenoisingOptions {
	readonly sampleRate: number;
	readonly channels: number;
	readonly workletUrl: string;
	readonly captureUrl: string;
	readonly speechBase64: string;
}

/** Observe the actual worklet output while Electron's utility process owns inference. */
export async function exerciseDenoisingPorts(page: Page, options: DenoisingOptions) {
	return page.evaluate(async ({ sampleRate, channels, workletUrl, captureUrl, speechBase64 }) => {
		interface Capture { frames: number; energy: number; finite: boolean }
		interface Metrics { provider: string; meanMs: number; p95Ms: number; p99Ms: number }
		const context = new AudioContext({ sampleRate });
		await context.suspend();
		let node: AudioWorkletNode | undefined;
		let capture: AudioWorkletNode | undefined;
		let source: AudioBufferSourceNode | undefined;
		const pair = new MessageChannel();
		try {
			await context.audioWorklet.addModule(workletUrl);
			await context.audioWorklet.addModule(captureUrl);
			node = new AudioWorkletNode(context, 'kw-ai-denoise', { outputChannelCount: [channels],
				channelCount: channels, channelCountMode: 'explicit', processorOptions: { channelCount: channels } });
			capture = new AudioWorkletNode(context, 'kw-audio-render-capture', { channelCount: channels,
				processorOptions: { startFrame: Math.round(context.currentTime * sampleRate),
					totalFrames: sampleRate * 3, channelCount: channels, chunkFrames: 4096 } });
			const bytes = Uint8Array.from(atob(speechBase64), value => value.charCodeAt(0));
			const decoded = await context.decodeAudioData(bytes.buffer);
			const buffer = context.createBuffer(channels, decoded.length, sampleRate);
			for (let c = 0; c < channels; c++) buffer.copyToChannel(decoded.getChannelData(c % decoded.numberOfChannels), c);
			source = context.createBufferSource(); source.buffer = buffer;
			const processor = node, sink = capture, input = source;
			return await new Promise<Capture & { stalled: boolean; metrics: Metrics }>((resolve, reject) => {
				let stalled = false, metrics: Metrics | undefined;
				const captured: Capture = { frames: 0, energy: 0, finite: true };
				const timer = setTimeout(() => finish(new Error('Denoising utility port timed out.')), 60_000);
				const finish = (error?: Error, value?: Capture): void => {
					clearTimeout(timer);
					if (error) reject(error);
					else if (value && metrics) resolve({ ...value, stalled, metrics });
					else reject(new Error('Missing denoising output or provider metrics.'));
				};
				processor.port.onmessage = ({ data }: MessageEvent<{ type: string; message?: string }>): void => {
					if (data.type === 'error') finish(new Error(data.message ?? 'Denoising processor failed.'));
				};
				processor.onprocessorerror = (): void => finish(new Error('Denoising AudioWorklet crashed.'));
				sink.port.onmessage = ({ data }: MessageEvent<{
					type: string; code?: string; frames: number; frameOffset: number; channels: Float32Array[];
				}>): void => {
					if (data.type === 'capture-error') { finish(new Error(data.code)); return; }
					if (data.type === 'done') { finish(undefined, captured); return; }
					if (data.type !== 'audio-chunk') return;
					if (data.frameOffset !== captured.frames) { finish(new Error('Denoising capture lost PCM frames.')); return; }
					captured.frames += data.frames;
					for (const plane of data.channels) for (const value of plane) {
						captured.energy += value * value; captured.finite &&= Number.isFinite(value);
					}
					sink.port.postMessage({ type: 'release-chunk' });
					if (captured.frames >= sampleRate && !stalled) {
						stalled = true;
						const end = performance.now() + 500;
						while (performance.now() < end) { /* Exercise inference through a blocked renderer UI. */ }
					}
				};
				pair.port2.onmessage = ({ data }: MessageEvent<{ type: string; message?: string; metrics: Metrics }>): void => {
					if (data.type !== 'ready') { finish(new Error(data.message ?? 'Denoising helper failed.')); return; }
					metrics = data.metrics;
					processor.port.postMessage({ type: 'attach' }, [pair.port2]);
					input.connect(processor).connect(sink).connect(context.destination);
					input.start();
					void context.resume().catch(error => finish(error instanceof Error ? error : new Error(String(error))));
				};
				pair.port2.onmessageerror = (): void => finish(new Error('Denoising port could not deserialize its result.'));
				pair.port2.start();
				const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(20)), byte => byte.toString(16).padStart(2, '0')).join('');
				window.postMessage({ type: 'soundscaper-ai-denoise-connect-v1',
					request: { sessionId, sampleRate: 48_000, channelCount: channels } }, location.origin, [pair.port1]);
			});
		} finally {
			node?.port.postMessage({ type: 'dispose' });
			source?.disconnect(); node?.disconnect(); capture?.disconnect();
			pair.port2.close();
			await context.close();
		}
	}, options);
}
