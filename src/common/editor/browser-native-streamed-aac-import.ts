/* SPDX-License-Identifier: AGPL-3.0-only */

import { initialAacSbrError } from './aac-initial-profile-error.ts';
import type { BrowserContainerAudioSample } from './browser-container-audio-decode.ts';

const MAXIMUM_PACKET_BYTES = 1024 * 1024;
const MAXIMUM_PENDING_FRAMES = 65_536;
const MAXIMUM_DECODE_QUEUE = 8;

interface AacPacket {
	readonly data: Uint8Array;
	readonly type: 'key' | 'delta';
	readonly timestamp: number;
	readonly duration: number;
	readonly byteLength: number;
}

interface NativeAacDecoder {
	readonly decodeQueueSize: number;
	configure(config: AudioDecoderConfig): void;
	decode(chunk: EncodedAudioChunk): void;
	flush(): Promise<void>;
	close(): void;
	addEventListener(type: 'dequeue', listener: () => void): void;
	removeEventListener(type: 'dequeue', listener: () => void): void;
}

/** Native AAC retains its synthesis state until EOF; every stored chunk applies backpressure. */
export function createNativeStreamedAacImport(options: Readonly<{
	config: AudioDecoderConfig;
	packets: () => AsyncIterable<AacPacket>;
	wrapSample: (data: AudioData) => BrowserContainerAudioSample;
	/** ADTS carries the AAC core clock; its first decoded frame may reconstruct SBR/PS. */
	allowImplicitSbr?: boolean;
	signal?: AbortSignal;
	createDecoder?: (init: AudioDecoderInit) => NativeAacDecoder;
	createChunk?: (init: EncodedAudioChunkInit) => EncodedAudioChunk;
}>): Readonly<{ samples: () => AsyncGenerator<BrowserContainerAudioSample>; dispose: () => void; failureSignal: AbortSignal }> {
	const controller = new AbortController();
	const failure = new AbortController();
	const queue: BrowserContainerAudioSample[] = [];
	let decoder: NativeAacDecoder | null = null;
	let packets: AsyncIterator<AacPacket> | null = null;
	let returned = false;
	let started = false;
	let queuedFrames = 0;
	let pendingFrames = 0;
	let timestampOffset = 0;
	const implicitSbr = options.allowImplicitSbr === true && options.config.codec === 'mp4a.40.2'
		&& !options.config.description && [1, 2].includes(options.config.numberOfChannels)
		&& Number.isSafeInteger(options.config.sampleRate) && options.config.sampleRate >= 8_000 && options.config.sampleRate <= 48_000;
	let outputRate: number | null = null;
	let outputChannels: number | null = null;
	let activeSample: BrowserContainerAudioSample | null = null;
	let wake: () => void = () => undefined;
	const returnPackets = (): void => {
		if (returned) return;
		returned = true;
		try { void packets?.return?.().catch(() => undefined); } catch { /* Preserve the original failure. */ }
	};
	const release = (): void => {
		options.signal?.removeEventListener('abort', onAbort);
		const active = decoder; decoder = null;
		active?.removeEventListener('dequeue', onDequeue);
		try { active?.close(); } catch { /* The native error or cancellation remains primary. */ }
		activeSample?.close(); activeSample = null;
		for (const sample of queue.splice(0)) sample.close();
		queuedFrames = 0; returnPackets(); wake();
	};
	const dispose = (): void => { if (!controller.signal.aborted) controller.abort(); };
	const fail = (error: unknown): void => { if (!controller.signal.aborted) { failure.abort(error); controller.abort(error); } };
	const onAbort = (): void => controller.abort(options.signal?.reason);
	const onDequeue = (): void => { wake(); };
	controller.signal.addEventListener('abort', release, { once: true });
	options.signal?.addEventListener('abort', onAbort, { once: true });
	if (options.signal?.aborted) onAbort();
	return Object.freeze({ dispose, failureSignal: failure.signal,
		async *samples(): AsyncGenerator<BrowserContainerAudioSample> {
			controller.signal.throwIfAborted();
			if (started) throw new Error('The compressed audio import decoder is closed.');
			started = true;
			try {
				decoder = (options.createDecoder ?? (init => new AudioDecoder(init)))({
					output(data) {
						if (controller.signal.aborted) { data.close(); return; }
						let sample: BrowserContainerAudioSample | null = null;
						try {
							sample = options.wrapSample(data);
							const frames = sample.numberOfFrames;
							const declared = sample.sampleRate === options.config.sampleRate && sample.numberOfChannels === options.config.numberOfChannels;
							const reconstructed = implicitSbr && sample.sampleRate === options.config.sampleRate * 2
								&& (sample.numberOfChannels === options.config.numberOfChannels || options.config.numberOfChannels === 1 && sample.numberOfChannels === 2);
							if (outputRate === null && !declared && !reconstructed && Number.isSafeInteger(frames) && frames > 0 && frames <= MAXIMUM_PENDING_FRAMES) {
								const profileError = initialAacSbrError(options.config, sample); if (profileError) throw profileError;
							}
							if (!Number.isSafeInteger(frames) || frames < 1 || frames > MAXIMUM_PENDING_FRAMES
								|| (outputRate === null ? !declared && !reconstructed : sample.sampleRate !== outputRate || sample.numberOfChannels !== outputChannels)
								|| queuedFrames + frames > MAXIMUM_PENDING_FRAMES) throw new RangeError('The decoded compressed audio sample geometry changed or is unsupported.');
							outputRate = sample.sampleRate; outputChannels = sample.numberOfChannels;
							const original = sample;
							let closed = false;
							queue.push(Object.freeze({ timestamp: original.timestamp - timestampOffset,
								sampleRate: original.sampleRate, numberOfFrames: frames, numberOfChannels: original.numberOfChannels, duration: original.duration,
								copyTo: (destination: Float32Array, copy: Parameters<BrowserContainerAudioSample['copyTo']>[1]) => original.copyTo(destination, copy),
								close() { if (!closed) { closed = true; original.close(); } },
							}));
							queuedFrames += frames; pendingFrames = Math.max(0, pendingFrames - frames * options.config.sampleRate / sample.sampleRate); wake();
						} catch (error) { if (sample) sample.close(); else data.close(); fail(error); }
					}, error(error) { fail(error); },
				});
				controller.signal.throwIfAborted();
				decoder.addEventListener('dequeue', onDequeue);
				decoder.configure(options.config);
				packets = options.packets()[Symbol.asyncIterator]();
				let firstPacket = true;
				let ended = false;
				let flushed = false;
				while (true) {
					controller.signal.throwIfAborted();
					if (queue.length > 0) {
						const sample = queue.shift()!; queuedFrames -= sample.numberOfFrames;
						activeSample = sample;
						try { yield sample; } finally { sample.close(); if (activeSample === sample) activeSample = null; }
						continue;
					}
					if (ended) {
						if (flushed) break;
						// Flushing between packets resets AAC overlap state in native pipelines.
						await abortable(decoder.flush(), controller.signal); flushed = true; continue;
					}
					if (decoder.decodeQueueSize >= MAXIMUM_DECODE_QUEUE) {
						await abortable(new Promise<void>(resolve => {
							wake = resolve;
							if (queue.length > 0 || decoder!.decodeQueueSize < MAXIMUM_DECODE_QUEUE) resolve();
						}), controller.signal); continue;
					}
					const next = await abortable(packets.next(), controller.signal);
					if (next.done) { ended = true; continue; }
					const packet = next.value;
					const frames = Math.round(packet.duration * options.config.sampleRate);
					const expansion = outputRate === null ? implicitSbr ? 2 : 1 : outputRate / options.config.sampleRate;
					if (!Number.isSafeInteger(packet.byteLength) || packet.byteLength < 1 || packet.byteLength > MAXIMUM_PACKET_BYTES
						|| packet.byteLength !== packet.data.byteLength || !Number.isFinite(packet.timestamp)
						|| !Number.isSafeInteger(frames) || frames < 1 || (pendingFrames + frames) * expansion > MAXIMUM_PENDING_FRAMES) {
						throw new RangeError('The decoded compressed audio sample geometry changed or is unsupported.');
					}
					if (firstPacket) { timestampOffset = Math.max(0, -packet.timestamp); firstPacket = false; }
					const timestamp = Math.round((packet.timestamp + timestampOffset) * 1_000_000);
					if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new RangeError('A compressed audio timestamp is outside the safe range.');
					// Negative timestamps select reverse playback in GStreamer. Its duration
					// conversion also treats microseconds as nanoseconds; omit that optional hint.
					const chunk = (options.createChunk ?? (init => new EncodedAudioChunk(init)))({ data: packet.data, type: packet.type, timestamp });
					pendingFrames += frames; decoder.decode(chunk);
				}
			} catch (error) { fail(error); throw error; } finally {
				options.signal?.removeEventListener('abort', onAbort);
				dispose(); release();
			}
		},
	});
}

/** Retain exactly one bounded decoded frame before publishing reconstructed source geometry. */
export async function primeNativeStreamedAacImport(session: ReturnType<typeof createNativeStreamedAacImport>, signal?: AbortSignal) {
	const iterator = session.samples();
	let disposed = false;
	const dispose = (): void => { if (!disposed) { disposed = true; session.dispose(); void iterator.return(undefined).catch(() => undefined); } };
	try {
		signal?.throwIfAborted();
		const first = await iterator.next();
		signal?.throwIfAborted();
		if (first.done) throw new Error('The source has no decodable compressed audio samples.');
		let started = false;
		return Object.freeze({ sampleRate: first.value.sampleRate, channelCount: first.value.numberOfChannels,
			failureSignal: session.failureSignal, dispose,
			async *samples(): AsyncGenerator<BrowserContainerAudioSample> {
				signal?.throwIfAborted();
				if (started || disposed) throw new Error('The compressed audio import decoder is closed.');
				started = true;
				try { yield first.value; yield* iterator; } finally { dispose(); }
			},
		});
	} catch (error) { dispose(); throw error; }
}

function abortable<Value>(operation: Promise<Value>, signal: AbortSignal): Promise<Value> {
	return new Promise<Value>((resolve, reject) => {
		const abort = (): void => { signal.removeEventListener('abort', abort); reject(signal.reason); };
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		void operation.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
			(error: unknown) => { signal.removeEventListener('abort', abort); reject(error); });
	});
}
