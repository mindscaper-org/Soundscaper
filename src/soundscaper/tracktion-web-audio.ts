/* SPDX-License-Identifier: AGPL-3.0-only */

import { TracktionAudioQueue, type TracktionAudioBuffers } from './tracktion-audio-queue.ts';
import { TracktionCaptureQueue } from './tracktion-capture-queue.ts';

type Microphone = Readonly<{
	stream: MediaStream;
	source: MediaStreamAudioSourceNode;
	queue: TracktionCaptureQueue;
}>;

export class TracktionWebAudio {
	#context: AudioContext | undefined;
	#preparing: Promise<readonly void[]> | undefined;
	#node: AudioWorkletNode | undefined;
	#microphone: Microphone | undefined;

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
		try {
			if (context.sampleRate !== sampleRate) throw new Error('The browser could not use the Tracktion project sample rate');
			this.#preparing = Promise.all([
				context.resume(),
				context.audioWorklet.addModule('/tracktion/tracktion-audio-worklet.js'),
			]);
			await this.#preparing;
		} catch (error) {
			if (this.#context === context) await this.close();
			throw error;
		} finally {
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
		const [prepared, captured] = await Promise.allSettled([
			this.prepare(sampleRate),
			devices.getUserMedia({
				audio: { channelCount: { ideal: 1 }, echoCancellation: false, autoGainControl: false, noiseSuppression: false },
			}),
		]);
		if (captured.status === 'rejected') throw captured.reason;
		const stream = captured.value;
		try {
			if (prepared.status === 'rejected') throw prepared.reason;
			const context = this.#context;
			if (!context) throw new Error('Browser audio output is unavailable');
			const source = context.createMediaStreamSource(stream);
			const queue = new TracktionCaptureQueue();
			this.#microphone = { stream, source, queue };
			return { output: this.outputBuffer(), capture: queue.shared };
		} catch (error) {
			for (const track of stream.getTracks()) track.stop();
			throw error;
		}
	}

	connect(buffers: TracktionAudioBuffers, onInterrupted?: () => void): void {
		const context = this.#context;
		if (!context) throw new Error('Prepare the browser audio output before playing');
		const microphone = buffers.capture ? this.#microphone : undefined;
		if (buffers.capture && !microphone?.stream.getAudioTracks().some((track) => track.readyState === 'live')) {
			throw new Error('The browser microphone disconnected while Tracktion was starting');
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
		for (const track of microphone.stream.getTracks()) track.stop();
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
