/* SPDX-License-Identifier: AGPL-3.0-only */

import { IdleEffectGate } from '../idle-effect-processing.ts';
import { idleEffectHoldFrames } from '../idle-effect-policy.ts';
import type { ParallelStackEffectProcessor } from './parallel-stack-effects.ts';
import type { ParallelStackEffect } from './parallel-stack-types.ts';

const EMPTY: readonly Float32Array[] = [];

export function withIdleParallelEffect(processor: ParallelStackEffectProcessor, effect: ParallelStackEffect,
	sampleRate: number, control?: SharedArrayBuffer): ParallelStackEffectProcessor {
	let params = effect.params;
	const gate = new IdleEffectGate(sampleRate, idleEffectHoldFrames(effect.type, params, sampleRate), () => processor.reset(), control);
	const inputs: (readonly Float32Array[])[] = [EMPTY, EMPTY];
	return {
		reset() { processor.reset(); gate.wake(); },
		updateParams(next, options) {
			if (!processor.updateParams) throw new Error('Parallel effect does not accept live parameters.');
			processor.updateParams(next, options);
			params = { ...params, ...next };
			gate.wake(idleEffectHoldFrames(effect.type, params, sampleRate));
		},
		processBlock(input, output, frames, sidechain) {
			inputs[0] = input; inputs[1] = sidechain ?? EMPTY;
			if (processor.transitioning) gate.wake();
			if (!gate.before(inputs, output, frames)) return;
			processor.processBlock(input, output, frames, sidechain);
			gate.after(output, frames);
		},
	};
}
