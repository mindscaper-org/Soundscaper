/* SPDX-License-Identifier: AGPL-3.0-only */

import { TracktionAudioQueue, type TracktionAudioBuffers } from './tracktion-audio-queue.ts';
import { TracktionCaptureQueue } from './tracktion-capture-queue.ts';

interface WorkletOptions {
	readonly processorOptions: TracktionAudioBuffers;
}

declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor();
}
declare function registerProcessor(name: string, processor: new (options?: WorkletOptions) => AudioWorkletProcessor): void;

class TracktionOutputProcessor extends AudioWorkletProcessor {
	readonly #queue: TracktionAudioQueue;
	readonly #capture: TracktionCaptureQueue | undefined;

	constructor(options?: WorkletOptions) {
		super();
		if (!options?.processorOptions.output) throw new Error('The Tracktion audio worklet requires an output queue');
		this.#queue = new TracktionAudioQueue(options.processorOptions.output);
		const { capture } = options.processorOptions;
		this.#capture = capture && new TracktionCaptureQueue(capture);
	}

	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const microphone = inputs[0]?.[0];
		if (microphone && this.#capture && !this.#capture.write(microphone)) this.port.postMessage('interrupted');
		const [left, right] = outputs[0] ?? [];
		if (left && right) this.#queue.read(left, right);
		return true;
	}
}

registerProcessor('soundscaper-tracktion-output', TracktionOutputProcessor);
