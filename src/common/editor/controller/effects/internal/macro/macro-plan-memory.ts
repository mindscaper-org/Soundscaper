/* SPDX-License-Identifier: AGPL-3.0-only */

interface MemoryPlan {
	readonly outputBytes: number;
	readonly peakBytes: number;
	readonly effects: readonly { readonly type: string; readonly params: Readonly<Record<string, unknown>> }[];
}

/** Serial tracks share scratch; publication retains PCM plus native buffers for every result. */
export function macroPlanPeakBytes(plans: readonly MemoryPlan[]): number {
	if (plans.length < 2) return plans[0]?.peakBytes ?? 0;
	if (plans.some(plan => plan.effects.some(effect => effect.type === 'audacity-truncate-silence' && effect.params.independent === false))) {
		// Linked truncation processes all aligned channel groups together.
		return plans.reduce((sum, plan) => sum + plan.peakBytes, 0);
	}
	const outputs = plans.reduce((sum, plan) => sum + plan.outputBytes, 0);
	return Math.max(outputs * 3, outputs + Math.max(...plans.map(plan => plan.peakBytes)));
}
