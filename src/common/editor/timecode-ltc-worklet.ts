/* SPDX-License-Identifier: AGPL-3.0-only */
import { LtcEncoder, LtcDecoder } from './timecode-ltc.ts';
import type { TimecodeRate } from './timecode-sync-format.ts';

declare const currentTime: number;
declare const sampleRate: number;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, processor: typeof TimecodeProcessor): void;
interface Configuration { rate: TimecodeRate; receive: boolean; inputChannel: number; outputChannel: number }
interface Anchor { playing: boolean; frame: number; startTime: number; speed: number }

class TimecodeProcessor extends AudioWorkletProcessor {
	private encoder: LtcEncoder | null = null;
	private decoder: LtcDecoder | null;
	private anchor: Anchor | null = null;
	private started = false;
	private receivedSamples = 0;
	private configuration: Configuration;
	constructor(options: AudioWorkletNodeOptions) {
		super(options);
		this.configuration = options.processorOptions as Configuration;
		this.decoder = this.configuration.receive ? new LtcDecoder(sampleRate, this.configuration.rate) : null;
		this.port.onmessage = (event: MessageEvent<Anchor>) => {
			this.anchor = event.data; this.started = false;
			this.encoder = event.data.playing ? new LtcEncoder(sampleRate, this.configuration.rate, event.data.speed) : null;
		};
	}
	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const input = inputs[0]?.[this.configuration.inputChannel];
		if (this.decoder && input) {
			const origin = this.receivedSamples;
			for (const reading of this.decoder.push(input)) {
				this.port.postMessage({ ...reading, time: currentTime + (reading.sample - origin) / sampleRate });
			}
			this.receivedSamples += input.length;
		}
		const output = outputs[0]?.[this.configuration.outputChannel];
		if (output && this.encoder && this.anchor) {
			const offset = Math.max(0, Math.ceil((this.anchor.startTime - currentTime) * sampleRate));
			if (offset < output.length) {
				if (!this.started) {
					this.encoder.seek(this.anchor.frame, Math.max(0, Math.round((currentTime - this.anchor.startTime) * sampleRate)));
					this.started = true;
				}
				this.encoder.write(output.subarray(offset));
			}
		}
		return true;
	}
}
registerProcessor('scape-timecode-ltc', TimecodeProcessor);
