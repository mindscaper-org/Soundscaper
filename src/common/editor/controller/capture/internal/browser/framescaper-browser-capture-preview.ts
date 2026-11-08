/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CapturePreviewSource } from '../../../../platform/capture-source-port.ts';
import type {
	FramescaperCaptureLevelMonitor,
	FramescaperCapturePreviewSurface,
} from '../../framescaper-capture-session-types.ts';

interface BrowserCaptureAudioNode { disconnect(): void }

interface BrowserCaptureAnalyser extends BrowserCaptureAudioNode {
	fftSize: number;
	readonly frequencyBinCount: number;
	getFloatTimeDomainData(values: Float32Array): void;
	disconnect(): void;
}

interface BrowserCaptureAudioSourceNode {
	connect(destination: BrowserCaptureAudioNode, output?: number): unknown;
	disconnect(): void;
}

interface BrowserCaptureAudioContext {
	readonly state: string;
	createMediaStreamSource(stream: unknown): BrowserCaptureAudioSourceNode;
	createAnalyser(): BrowserCaptureAnalyser;
	createChannelSplitter?(outputs: number): BrowserCaptureAudioSourceNode;
	resume?(): PromiseLike<void> | void;
	close(): PromiseLike<void> | void;
}

export interface BrowserFramescaperCaptureLevelDependencies {
	readonly createAudioContext?: () => BrowserCaptureAudioContext;
	readonly setInterval?: (callback: () => void, intervalMs: number) => unknown;
	readonly clearInterval?: (timer: unknown) => void;
}

/** Modern browsers preview MediaStreams through `srcObject`; no synthetic URL is created. */
export function createBrowserFramescaperCapturePreviewSurface<Stream, Track>(
	source: Readonly<CapturePreviewSource<Stream, Track>>,
): FramescaperCapturePreviewSurface {
	if (source.role !== 'camera' && source.role !== 'display') {
		throw new TypeError('A browser video preview requires a camera or display source.');
	}
	let disposed = false;
	return Object.freeze({
		url: null,
		stream: source.stream,
		dispose() { disposed = true; },
		get disposed() { return disposed; },
	});
}

/** Builds a silent Web Audio RMS meter; it never connects the source to an output. */
export async function createBrowserFramescaperCaptureLevelMonitor<Stream, Track>(
	source: Readonly<CapturePreviewSource<Stream, Track>>,
	onLevel: () => void,
	dependencies: BrowserFramescaperCaptureLevelDependencies = {},
): Promise<FramescaperCaptureLevelMonitor> {
	if (source.role !== 'microphone' && source.role !== 'system-audio') {
		throw new TypeError('A browser capture level monitor requires an audio source.');
	}
	const context = (dependencies.createAudioContext ?? createRuntimeAudioContext)();
	let sourceNode: BrowserCaptureAudioSourceNode | null = null;
	let splitter: BrowserCaptureAudioSourceNode | null = null;
	const analysers: BrowserCaptureAnalyser[] = [];
	let timer: unknown = null;
	let level: number | null = null;
	let disposed = false;
	try {
		sourceNode = context.createMediaStreamSource(source.stream);
		const requestedChannels = source.settings.channelCount;
		const channelCount = typeof requestedChannels === 'number' && Number.isSafeInteger(requestedChannels)
			&& requestedChannels > 1 && requestedChannels <= 32 && context.createChannelSplitter ? requestedChannels : 1;
		if (channelCount > 1) splitter = context.createChannelSplitter!(channelCount);
		for (let channel = 0; channel < channelCount; channel += 1) {
			const analyser = context.createAnalyser();
			analysers.push(analyser);
			analyser.fftSize = 2_048;
			if (splitter) splitter.connect(analyser, channel);
		}
		sourceNode.connect(splitter ?? analysers[0]!);
		if (context.state === 'suspended') await context.resume?.();
		const samples = new Float32Array(Math.max(1, analysers[0]!.fftSize));
		const sample = (): void => {
			if (disposed) return;
			try {
				let sum = 0;
				for (const analyser of analysers) {
					analyser.getFloatTimeDomainData(samples);
					for (const value of samples) sum += value * value;
				}
				level = Math.max(0, Math.min(1, Math.sqrt(sum / (samples.length * analysers.length))));
			} catch {
				level = null;
			}
			try { onLevel(); } catch { /* UI observers cannot own capture resources. */ }
		};
		timer = (dependencies.setInterval ?? runtimeSetInterval)(sample, 50);
	} catch (error) {
		try { sourceNode?.disconnect(); } catch { /* Continue exact cleanup. */ }
		try { splitter?.disconnect(); } catch { /* Continue exact cleanup. */ }
		for (const analyser of analysers) { try { analyser.disconnect(); } catch { /* Continue exact cleanup. */ } }
		try { await context.close(); } catch { /* Preserve the construction failure. */ }
		throw error;
	}

	return Object.freeze({
		get level() { return level; },
		async dispose() {
			if (disposed) return;
			disposed = true;
			if (timer !== null) (dependencies.clearInterval ?? runtimeClearInterval)(timer);
			const failures: unknown[] = [];
			try { sourceNode?.disconnect(); } catch (error) { failures.push(error); }
			try { splitter?.disconnect(); } catch (error) { failures.push(error); }
			for (const analyser of analysers) { try { analyser.disconnect(); } catch (error) { failures.push(error); } }
			try { await context.close(); } catch (error) { failures.push(error); }
			level = null;
			if (failures.length) throw new AggregateError(failures, 'Capture level monitor did not release cleanly.');
		},
	});
}

function createRuntimeAudioContext(): BrowserCaptureAudioContext {
	if (typeof globalThis.AudioContext !== 'function') {
		throw new Error('Web Audio level metering is unavailable in this runtime.');
	}
	return new globalThis.AudioContext({ latencyHint: 'interactive' }) as unknown as BrowserCaptureAudioContext;
}

function runtimeSetInterval(callback: () => void, intervalMs: number): unknown {
	return globalThis.setInterval(callback, intervalMs);
}

function runtimeClearInterval(timer: unknown): void {
	globalThis.clearInterval(timer as ReturnType<typeof globalThis.setInterval>);
}
