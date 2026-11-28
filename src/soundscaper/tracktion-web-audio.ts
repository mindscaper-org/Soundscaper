/* SPDX-License-Identifier: AGPL-3.0-only */

import { raceAbortablePromise } from '../common/foundation/abort-race.ts';
import { TracktionAudioQueue, type TracktionAudioBuffers } from './tracktion-audio-queue.ts';
import { TracktionCaptureQueue } from './tracktion-capture-queue.ts';

type Microphone = Readonly<{
	stream: MediaStream;
	source: MediaStreamAudioSourceNode;
	queue: TracktionCaptureQueue;
}>;

const audioStartupTimeoutMs = 10_000;
const workletPath = '/tracktion/tracktion-audio-worklet.js';
const microphoneDisconnected = 'The browser microphone disconnected while Tracktion was starting';

function stopMicrophoneTracks(stream: MediaStream): void {
	for (const track of stream.getTracks()) track.stop();
}

export class TracktionWebAudio {
	#context: AudioContext | undefined;
	#preparing: Promise<readonly void[]> | undefined;
	#node: AudioWorkletNode | undefined;
	#microphone: Microphone | undefined;
	#retryWorklet = false;

	get playing(): boolean { return this.#node !== undefined; }

	async prepare(sampleRate: number): Promise<void> {
		if (this.#preparing) {
			await this.#preparing;
			return;
		}
		if (this.#context) {
			await this.#context.resume();
			return;
		}
		const context = new AudioContext({ sampleRate });
		this.#context = context;
		const timeout = new Error('Browser audio startup timed out. Try again.');
		let deadline: ReturnType<typeof setTimeout> | undefined;
		try {
			if (context.sampleRate !== sampleRate) throw new Error('The browser could not use the Tracktion project sample rate');
			// A failed request can remain in the browser cache after its context closes.
			const module = this.#retryWorklet ? `${workletPath}?retry=${crypto.randomUUID()}` : workletPath;
			this.#preparing = Promise.race([
				Promise.all([context.resume(), context.audioWorklet.addModule(module)]),
				new Promise<never>((_, reject) => {
					deadline = setTimeout(() => reject(timeout), audioStartupTimeoutMs);
				}),
			]);
			await this.#preparing;
		} catch (error) {
			if (this.#context === context) {
				this.#retryWorklet = true;
				// A stalled context cannot hold up retry or hide the startup error.
				void this.close().catch(() => undefined);
			}
			throw error;
		} finally {
			clearTimeout(deadline);
			if (this.#context === context) this.#preparing = undefined;
		}
	}

	outputBuffer(): SharedArrayBuffer {
		if (!this.#context) throw new Error('Prepare the browser audio output before playing');
		return new TracktionAudioQueue().shared;
	}

	async microphoneBuffers(sampleRate: number): Promise<TracktionAudioBuffers> {
		const devices = navigator.mediaDevices;
		if (!devices?.getUserMedia) throw new Error('Browser microphone recording is unavailable');
		// Start output and ask for the input in the same user gesture.
		const startup = new AbortController();
		const preparing = this.prepare(sampleRate);
		const context = this.#context;
		let microphoneRefused = false;
		void preparing.catch((error: unknown) => {
			if (!microphoneRefused) startup.abort(error);
		});
		const requesting = devices.getUserMedia({
			audio: { channelCount: { ideal: 1 }, echoCancellation: false, autoGainControl: false, noiseSuppression: false },
		}).catch(async (error: unknown) => {
			microphoneRefused = true;
			// A reused audio context can still be resuming before the bridge suspends it again.
			if (!this.#closeStartingOutput(context)) await preparing.catch(() => undefined);
			throw error;
		});
		const disconnected = new Error(microphoneDisconnected);
		let stream: MediaStream | undefined;
		try {
			stream = await raceAbortablePromise(requesting, startup.signal);
			const tracks = stream.getAudioTracks();
			const hasLiveTrack = () => tracks.some((track) => track.readyState === 'live');
			if (!hasLiveTrack()) throw disconnected;
			const interrupt = () => startup.abort(disconnected);
			for (const track of tracks) track.addEventListener('ended', interrupt, { signal: startup.signal });
			await raceAbortablePromise(preparing, startup.signal);
			if (!hasLiveTrack()) throw disconnected;
			if (!context || this.#context !== context) throw new Error('Browser audio output is unavailable');
			const source = context.createMediaStreamSource(stream);
			const queue = new TracktionCaptureQueue();
			this.#microphone = { stream, source, queue };
			return { output: this.outputBuffer(), capture: queue.shared };
		} catch (error) {
			if (error === disconnected) this.#closeStartingOutput(context);
			if (stream) stopMicrophoneTracks(stream);
			// The browser permission prompt can still resolve after this startup has ended.
			else void requesting.then(stopMicrophoneTracks).catch(() => undefined);
			throw error;
		} finally {
			startup.abort();
		}
	}

	#closeStartingOutput(context: AudioContext | undefined): boolean {
		if (this.#context !== context || !this.#preparing) return false;
		this.#retryWorklet = true;
		void this.close().catch(() => undefined);
		return true;
	}

	connect(buffers: TracktionAudioBuffers, onInterrupted?: () => void): void {
		const context = this.#context;
		if (!context) throw new Error('Prepare the browser audio output before playing');
		const microphone = buffers.capture ? this.#microphone : undefined;
		if (buffers.capture && !microphone?.stream.getAudioTracks().some((track) => track.readyState === 'live')) {
			throw new Error(microphoneDisconnected);
		}
		const node = new AudioWorkletNode(context, 'soundscaper-tracktion-output', {
			numberOfInputs: microphone ? 1 : 0, numberOfOutputs: 1, outputChannelCount: [2],
			channelCount: 1, channelCountMode: 'explicit', processorOptions: buffers,
		});
		this.#disconnectOutput();
		this.#node = node;
		if (microphone) {
			const interrupt = () => {
				if (this.#microphone !== microphone) return;
				this.sealCapture();
				onInterrupted?.();
			};
			node.port.onmessage = interrupt;
			node.addEventListener('processorerror', interrupt, { once: true });
			for (const track of microphone.stream.getAudioTracks()) track.addEventListener('ended', interrupt, { once: true });
			microphone.source.connect(node);
		}
		node.connect(context.destination);
	}

	sealCapture(): void {
		const microphone = this.#microphone;
		this.#microphone = undefined;
		if (!microphone) return;
		microphone.queue.seal();
		microphone.source.disconnect();
		stopMicrophoneTracks(microphone.stream);
	}

	#disconnectOutput(): void {
		this.#node?.disconnect();
		this.#node?.port.close();
		this.#node = undefined;
	}

	#disconnect(): void {
		this.sealCapture();
		this.#disconnectOutput();
	}

	async stop(): Promise<void> {
		this.#disconnect();
		const context = this.#context;
		if (context && context.state !== 'closed' && context.state !== 'suspended') {
			// Preserve the transport reply if the browser rejects output cleanup.
			await context.suspend().catch(() => undefined);
		}
	}

	async close(): Promise<void> {
		this.#disconnect();
		const context = this.#context;
		this.#context = undefined;
		this.#preparing = undefined;
		if (context) await context.close();
	}
}
