/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperAudioDataLike,
	FramescaperAudioTrackProcessorConstructor,
	FramescaperAudioTrackProcessorReader,
	FramescaperAudioTrackProcessorLike,
	FramescaperBrowserAudioRecorder,
	FramescaperBrowserAudioRecorderOptions,
	FramescaperCaptureAudioRecorderState,
} from './framescaper-browser-audio-recorder.ts';
import { createFramescaperAudioDataChunker } from './framescaper-audio-data-chunker.ts';
import { createFramescaperAudioDataFrameClock, readNativeAudioDataCounters } from './framescaper-audio-data-frame-clock.ts';

interface ActualAudioFormat {
	readonly sampleRate: number;
	readonly channelCount: number;
}

interface PcmSink {
	readonly pendingChunks: number;
	readonly acceptedInputFrameEnd: number | null;
	push(chunk: Readonly<{
		readonly frameStart: number;
		readonly frames: number;
		readonly channels: readonly Float32Array[];
	}>): Promise<void>;
	settle(): Promise<void>;
}

interface FailureChannel {
	readonly failure: Error | null;
	fail(error: unknown): Error;
}

export function createFramescaperBrowserAudioProcessorRecorder(input: Readonly<{
	options: FramescaperBrowserAudioRecorderOptions;
	Processor: FramescaperAudioTrackProcessorConstructor;
	format: ActualAudioFormat;
	chunkFrames: number;
	maximumPendingChunks: number;
	inputGain: number;
	sink: PcmSink;
	failures: FailureChannel;
	createFallback?: () => Promise<FramescaperBrowserAudioRecorder>;
}>): FramescaperBrowserAudioRecorder {
	const { options, format, chunkFrames, inputGain, sink, failures } = input;
	let state: FramescaperCaptureAudioRecorderState = 'ready';
	let inputFrameStart = 0;
	const frameClock = createFramescaperAudioDataFrameClock(format.sampleRate);
	let reader: FramescaperAudioTrackProcessorReader | null = null;
	let processor: FramescaperAudioTrackProcessorLike | null = null;
	let fallback: FramescaperBrowserAudioRecorder | null = null;
	let readLoop: Promise<void> | null = null;
	let startPromise: Promise<void> | null = null;
	let cancelPromise: Promise<void> | null = null;
	let released = false;
	let stopPromise: Promise<void> | null = null;
	let disposePromise: Promise<void> | null = null;
	const chunks = createFramescaperAudioDataChunker({
		channelCount: format.channelCount, chunkFrames, inputGain,
		onChunk: chunk => {
			const write = sink.push(chunk);
			void write.catch((error: unknown) => { fail(error); });
			if (failures.failure) throw failures.failure;
		},
	});

	function start(startFrameValue = 0): Promise<void> | void {
		assertStartable(currentState(), failures.failure, startPromise);
		inputFrameStart = boundedInteger(startFrameValue, 0, Number.MAX_SAFE_INTEGER, 'Capture audio start frame');
		let nativeReady = false;
		try {
			processor = new input.Processor({
				track: options.track,
				maxBufferSize: input.maximumPendingChunks,
			});
			reader = processor.readable.getReader();
			const counters = readNativeAudioDataCounters(processor);
			if (!counters) throw new DOMException('Native audio discard counters are unavailable.', 'NotSupportedError');
			nativeReady = true;
			frameClock.start(inputFrameStart, counters);
			state = 'recording';
			readLoop = runReader();
			void readLoop.catch(() => undefined);
		} catch (error) {
			if (nativeReady || !input.createFallback) {
				state = 'failed';
				throw failures.fail(error);
			}
			startPromise = (async () => {
				await cancelReader(); releaseReader();
				const created = await input.createFallback!();
				fallback = created;
				await created.start(inputFrameStart);
			})().catch((fallbackError: unknown) => {
				state = 'failed';
				throw failures.fail(fallbackError);
			});
			return startPromise;
		}
	}

	function pause(): boolean {
		if (fallback) return fallback.pause();
		assertUsable(state, failures.failure);
		if (state !== 'recording') return false;
		try { chunks.flush(); } catch (error) { throw fail(error); }
		state = 'paused';
		return true;
	}

	function resume(): boolean {
		if (fallback) return fallback.resume();
		assertUsable(state, failures.failure);
		if (state !== 'paused') return false;
		state = 'recording';
		return true;
	}

	function stop(): Promise<void> {
		if (stopPromise) return stopPromise;
		stopPromise = (async () => {
			await startPromise?.catch(() => undefined);
			if (fallback) return fallback.stop();
			if (state !== 'disposed') state = failures.failure ? 'failed' : 'stopping';
			try { await cancelReader(); } catch { /* Failure channel retains the error. */ }
			if (readLoop) {
				try { await readLoop; } catch { /* Failure channel retains the error. */ }
			} else releaseReader();
			if (!failures.failure) {
				try { chunks.flush(); } catch (error) { fail(error); }
			}
			try { await sink.settle(); } catch { /* Failure channel retains the error. */ }
			if (failures.failure) throw failures.failure;
			if (state !== 'disposed') state = 'stopped';
		})();
		return stopPromise;
	}

	function dispose(): Promise<void> {
		if (disposePromise) return disposePromise;
		disposePromise = stop().finally(async () => {
			if (fallback) await fallback.dispose();
			state = 'disposed';
		});
		return disposePromise;
	}

	async function runReader(): Promise<void> {
		try {
			while (state === 'recording' || state === 'paused') {
				const result = await requiredReader().read();
				if (result.done) {
					if (state === 'recording' || state === 'paused') {
						fail(new Error('The capture audio track ended unexpectedly.'));
					}
					break;
				}
				const data = result.value;
				if (!data) throw new Error('The capture audio processor returned an empty frame.');
				try {
					validateAudioData(data, format);
					const counters = processor && readNativeAudioDataCounters(processor);
					if (!counters) throw new Error('Native audio discard counters became unavailable.');
					const frameStart = frameClock.map(data.timestamp, data.numberOfFrames, counters);
					if (!isAcceptingProcessorData()) continue;
					chunks.append(data, frameStart);
				} finally {
					try { data.close(); } catch (error) { fail(error); }
				}
				if (failures.failure) break;
			}
		} catch (error) {
			if (state !== 'stopping' && state !== 'disposed') fail(error);
		} finally {
			if (failures.failure) {
				try { await cancelReader(); } catch { /* Continue exact reader release. */ }
			}
			releaseReader();
		}
		if (failures.failure) throw failures.failure;
	}

	function fail(error: unknown): Error {
		const failure = failures.fail(error);
		chunks.discard();
		state = 'failed';
		void cancelReader().catch(() => undefined);
		return failure;
	}

	function isAcceptingProcessorData(): boolean { return state === 'recording'; }

	function cancelReader(): Promise<void> {
		if (cancelPromise) return cancelPromise;
		if (!reader) return Promise.resolve();
		cancelPromise = Promise.resolve().then(() => released ? undefined : reader?.cancel?.()).then(() => undefined).catch((error: unknown) => {
			if (!failures.failure) failures.fail(error);
			throw failures.failure ?? error;
		});
		return cancelPromise;
	}

	function releaseReader(): void {
		if (released || !reader) return;
		released = true;
		try { reader.releaseLock(); } catch (error) { failures.fail(error); }
	}

	function currentState(): FramescaperCaptureAudioRecorderState {
		return fallback?.state ?? state;
	}

	function requiredReader(): FramescaperAudioTrackProcessorReader {
		if (!reader) throw new Error('Capture audio processor reader is unavailable.');
		return reader;
	}

	return Object.freeze({
		role: options.role,
		get backend() { return fallback?.backend ?? 'track-processor' as const; },
		get state() { return currentState(); },
		sampleRate: format.sampleRate,
		channelCount: format.channelCount,
		chunkFrames,
		get monitoring() { return fallback?.monitoring ?? false; },
		inputGain,
		get pendingChunks() { return sink.pendingChunks; },
		get acceptedInputFrameEnd() { return fallback?.acceptedInputFrameEnd ?? sink.acceptedInputFrameEnd; },
		track: options.track,
		start,
		pause,
		resume,
		stop,
		dispose,
	});
}

function validateAudioData(data: FramescaperAudioDataLike, format: ActualAudioFormat): void {
	boundedInteger(data.numberOfFrames, 1, 1_048_576, 'Capture AudioData frame count');
	if (data.sampleRate !== format.sampleRate || data.numberOfChannels !== format.channelCount) {
		throw new Error('Capture AudioData does not match the source track actual format.');
	}
	if (typeof data.copyTo !== 'function' || typeof data.close !== 'function') {
		throw new TypeError('Capture processor returned invalid AudioData.');
	}
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`${name} must be an integer between ${String(minimum)} and ${String(maximum)}.`);
	}
	return Number(value);
}


function assertStartable(
	state: FramescaperCaptureAudioRecorderState,
	failure: Error | null,
	startPromise: Promise<void> | null,
): void {
	if (state === 'failed') throw failure ?? new Error('Capture audio recorder failed.');
	if (state !== 'ready' || startPromise) throw new Error('Capture audio recorder can start only once.');
}

function assertUsable(state: FramescaperCaptureAudioRecorderState, failure: Error | null): void {
	if (state === 'failed') throw failure ?? new Error('Capture audio recorder failed.');
	if (state === 'disposed') throw new Error('Capture audio recorder has been disposed.');
}
