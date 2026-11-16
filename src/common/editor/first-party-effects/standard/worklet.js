/* SPDX-License-Identifier: AGPL-3.0-only */

import { isStandardEffect } from './definition.ts';
import { createStandardEffectProcessor } from './dsp.ts';
import { instantiateStaffPadWasm } from '../../staffpad/wasm-instance.ts';
import { IdleEffectGate } from '../../idle-effect-processing.ts';
import { idleEffectHoldFrames } from '../../idle-effect-policy.ts';

export class StandardEffectProcessor extends (globalThis.AudioWorkletProcessor || class {}) {
	constructor(options = {}) {
		super();
		this.disposed = false;
		const settings = options.processorOptions || {};
		this.params = settings.params || {};
		this.effectType = settings.type;
		this.idle = new IdleEffectGate(globalThis.sampleRate,
			idleEffectHoldFrames(settings.type, this.params, globalThis.sampleRate), () => this.processor.reset());
		if (!isStandardEffect(settings.type)) throw new RangeError('Unknown standard effect.');
		this.processor = createStandardEffectProcessor({ type: settings.type,
			sampleRate: globalThis.sampleRate, channelCount: settings.channelCount || 2,
			params: settings.params || {},
			staffPadRuntime: settings.staffPadWasmModule ? instantiateStaffPadWasm(settings.staffPadWasmModule) : undefined });
		if (this.port) this.port.onmessage = ({ data }) => {
			if (this.idle.handleMessage(data || {})) return;
			if (this.disposed) return;
			try {
				if (data?.type === 'configure') {
					this.processor.updateParams(data.params || {});
					this.params = { ...this.params, ...data.params };
					this.idle.wake(idleEffectHoldFrames(this.effectType, this.params, globalThis.sampleRate));
				}
				else if (data?.type === 'reset') { this.processor.reset(); this.idle.wake(); }
				else if (data?.type === 'dispose') {
					this.disposed = true;
					this.processor.dispose?.();
				}
			} catch (error) {
				this.port.postMessage({ type: 'error', message: String(error?.message || error) });
			}
		};
	}
	process(inputs, outputs) {
		const output = outputs[0] || [];
		if (this.disposed) {
			for (const channel of output) channel.fill(0);
			return false;
		}
		const frames = output[0]?.length || 0;
		if (frames && this.idle.before(inputs, output, frames)) {
			this.processor.processBlock(inputs[0] || [], output, frames);
			this.idle.after(output, frames);
		}
		return true;
	}
}

if (typeof globalThis.registerProcessor === 'function') globalThis.registerProcessor('kw-standard-effect', StandardEffectProcessor);
