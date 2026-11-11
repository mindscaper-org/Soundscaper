/* SPDX-License-Identifier: AGPL-3.0-only */

import { instantiateStaffPadWasm } from '../../staffpad/wasm-instance.ts';
import { createAutoTuneProcessor } from './dsp.ts';
import type { AutoTuneControlNote } from './control-notes.ts';

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, processor: typeof AutoTuneWorkletProcessor): void;

interface Settings {
	readonly channelCount?: number;
	readonly params?: Readonly<Record<string, unknown>>;
	readonly staffPadWasmModule?: WebAssembly.Module;
	readonly controlSchedules?: readonly { readonly notes: readonly AutoTuneControlNote[]; readonly fromFrame: number; readonly toFrame: number }[];
}
interface Control {
	readonly type?: string; readonly params?: Readonly<Record<string, unknown>>;
	readonly notes?: readonly AutoTuneControlNote[]; readonly fromFrame?: number; readonly toFrame?: number;
}

export class AutoTuneWorkletProcessor extends AudioWorkletProcessor {
	private readonly processor: ReturnType<typeof createAutoTuneProcessor>;
	private disposed = false;
	constructor(options: AudioWorkletNodeOptions = {}) {
		super(options);
		const settings = options.processorOptions as Settings | undefined;
		if (!(settings?.staffPadWasmModule instanceof WebAssembly.Module)) throw new Error('Auto-Tune requires the compiled StaffPad module.');
		this.processor = createAutoTuneProcessor({ sampleRate, channelCount: settings.channelCount ?? 2,
			params: settings.params, staffPadRuntime: instantiateStaffPadWasm(settings.staffPadWasmModule) });
		for (const schedule of settings.controlSchedules ?? []) {
			this.processor.scheduleControlNotes(schedule.notes, schedule.fromFrame, schedule.toFrame);
		}
		this.port.onmessage = ({ data }: MessageEvent<Control>): void => {
			if (this.disposed) return;
			try {
				if (data.type === 'configure') this.processor.updateParams(data.params ?? {});
				else if (data.type === 'control-notes') this.processor.scheduleControlNotes(data.notes ?? [], Number(data.fromFrame), Number(data.toFrame));
				else if (data.type === 'reset') this.processor.reset();
				else if (data.type === 'dispose') this.dispose();
			} catch (error) { this.fail(error); }
		};
	}
	private dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.processor.dispose();
	}
	private fail(error: unknown): void {
		this.dispose();
		this.port.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
	}
	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const output = outputs[0] ?? [];
		if (!this.disposed) {
			try { if (output.length) this.processor.processBlock(inputs[0] ?? [], output, output[0].length, currentFrame); }
			catch (error) { this.fail(error); }
		}
		if (this.disposed) for (const channel of output) channel.fill(0);
		return !this.disposed;
	}
}

if (typeof registerProcessor === 'function') registerProcessor('kw-auto-tune', AutoTuneWorkletProcessor);
