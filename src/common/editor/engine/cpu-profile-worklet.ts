/* SPDX-License-Identifier: AGPL-3.0-only */

export {};

declare const AudioWorkletProcessor: {
	new(): { readonly port: MessagePort };
};
declare function registerProcessor(name: string, processor: unknown): void;

/** Transparent pull-graph boundaries. Chromium records thread CPU timestamps. */
class CpuProfileBoundary extends AudioWorkletProcessor {
	private readonly control: Int32Array<SharedArrayBuffer>;
	private readonly label: string;
	private readonly begin: boolean;
	constructor(options: { processorOptions: { control: SharedArrayBuffer; label: string; edge: string } }) {
		super();
		this.control = new Int32Array(options.processorOptions.control);
		this.label = options.processorOptions.label;
		this.begin = options.processorOptions.edge === 'begin';
	}
	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const active = Atomics.load(this.control, 0) === 1;
		if (active && !this.begin) console.timeStamp(this.label);
		const input = inputs[0] ?? [];
		const output = outputs[0] ?? [];
		for (let channel = 0; channel < output.length; channel++) {
			if (input[channel]) output[channel]!.set(input[channel]!);
			else output[channel]!.fill(0);
		}
		if (active && this.begin) console.timeStamp(this.label);
		return true;
	}
}
registerProcessor('scape-cpu-boundary', CpuProfileBoundary);
