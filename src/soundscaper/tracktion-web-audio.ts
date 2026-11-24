/* SPDX-License-Identifier: AGPL-3.0-only */

import { TracktionAudioQueue } from './tracktion-audio-queue.ts';

export class TracktionWebAudio {
	#context: AudioContext | undefined;
	#node: AudioWorkletNode | undefined;

	get playing(): boolean { return this.#node !== undefined; }

	async prepare(sampleRate: number): Promise<void> {
		if (this.#context) {
			await this.#context.resume();
			return;
		}
		const context = new AudioContext({ sampleRate });
		try {
			if (context.sampleRate !== sampleRate) throw new Error('The browser could not use the Tracktion project sample rate');
			await Promise.all([
				context.resume(),
				context.audioWorklet.addModule(new URL('tracktion-audio-worklet.js', window.location.href)),
			]);
			this.#context = context;
		} catch (error) {
			await context.close();
			throw error;
		}
	}

	buffer(): SharedArrayBuffer {
		if (!this.#context) throw new Error('Prepare the browser audio output before playing');
		return new TracktionAudioQueue().shared;
	}

	connect(shared: SharedArrayBuffer): void {
		const context = this.#context;
		if (!context) throw new Error('Prepare the browser audio output before playing');
		const node = new AudioWorkletNode(context, 'soundscaper-tracktion-output', {
			numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { shared },
		});
		this.stop();
		this.#node = node;
		node.connect(context.destination);
	}

	stop(): void {
		this.#node?.disconnect();
		this.#node?.port.close();
		this.#node = undefined;
	}

	async close(): Promise<void> {
		this.stop();
		const context = this.#context;
		this.#context = undefined;
		if (context) await context.close();
	}
}
