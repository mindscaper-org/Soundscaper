/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEnvelopeValueEvaluator } from '../automation.js';
import type { ClipSchedulePlan } from './clip-schedule-plan.ts';
import type { EngineClip } from './types.ts';

type Evaluator = (frame: number) => number;
interface PreparedEnvelope { readonly clip: EngineClip; readonly duration: number; readonly evaluate: Evaluator }
// Keys are invocation-owned plans, so preparations retire with their schedule.
const prepared = new WeakMap<object, PreparedEnvelope>();

export function prepareClipScheduleEnvelopes(plans: ClipSchedulePlan[]): ClipSchedulePlan[] {
	const clips = new Map<EngineClip, Map<number, Evaluator>>();
	for (const plan of plans) {
		let durations = clips.get(plan.clip);
		if (!durations) { durations = new Map(); clips.set(plan.clip, durations); }
		let evaluate = durations.get(plan.duration);
		if (!evaluate) {
			evaluate = createEnvelopeValueEvaluator(Array.isArray(plan.clip.envelope) ? plan.clip.envelope : [], plan.duration) as Evaluator;
			durations.set(plan.duration, evaluate);
		}
		prepared.set(plan, { clip: plan.clip, duration: plan.duration, evaluate });
	}
	return plans;
}

export function clipEnvelopeEvaluator(options: object, clip: EngineClip, duration: number): Evaluator {
	const owned = prepared.get(options);
	return owned?.clip === clip && owned.duration === duration ? owned.evaluate
		: createEnvelopeValueEvaluator(Array.isArray(clip.envelope) ? clip.envelope : [], duration) as Evaluator;
}
