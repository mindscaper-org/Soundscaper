/* SPDX-License-Identifier: AGPL-3.0-only */

import { TracktionAudioQueue } from './tracktion-audio-queue.ts';

interface WorkletOptions {
	readonly processorOptions: Readonly<{ shared: SharedArrayBuffer }>;
}

declare class AudioWorkletProcessor {
	constructor();
}
declare function registerProcessor(name: string, processor: new (options?: WorkletOptions) => AudioWorkletProcessor): void;

class TracktionOutputProcessor extends AudioWorkletProcessor {
	readonly #queue: TracktionAudioQueue;

	constructor(options?: WorkletOptions) {
		super();
		if (!options?.processorOptions.shared) throw new Error('The Tracktion audio worklet requires an output queue');
		this.#queue = new TracktionAudioQueue(options.processorOptions.shared);
	}

	process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const [left, right] = outputs[0] ?? [];
		if (left && right) this.#queue.read(left, right);
		return true;
	}
}

registerProcessor('soundscaper-tracktion-output', TracktionOutputProcessor);
