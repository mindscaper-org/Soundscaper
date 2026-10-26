/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareNativeMediaPlanEnvelopeWithDeferredTimingReferencesV2 } from '../common/editor/native-media-plan-envelope-v2.ts';
import type { OfxContext } from '../common/editor/native-ofx-descriptor.ts';
import type { UnifiedExactRenderOpenFxNode, UnifiedExactRenderPlanV14 } from '../common/editor/unified-exact-render-plan.ts';

interface Target {
	readonly effects: readonly UnifiedExactRenderOpenFxNode[];
	readonly inputs: readonly string[];
	readonly enabled: boolean;
}
export interface FramescaperOwnedOpenFxGraphIndexNativeMedia {
	readonly plan: UnifiedExactRenderPlanV14;
	has(context: OfxContext, targetId: string): boolean;
	inputs(context: OfxContext, targetId: string): readonly string[];
	effects(context: OfxContext, targetId: string): readonly UnifiedExactRenderOpenFxNode[];
}
const INDICES = new WeakMap<object, FramescaperOwnedOpenFxGraphIndexNativeMedia>();
const NO_EFFECTS: readonly UnifiedExactRenderOpenFxNode[] = Object.freeze([]);
const NO_INPUTS: readonly string[] = Object.freeze([]);

/** Only this factory captures an immutable operation plan; generic frame graphs keep their mutable fallback. */
export function prepareFramescaperOwnedOpenFxGraphIndexNativeMedia(value: UnifiedExactRenderPlanV14): FramescaperOwnedOpenFxGraphIndexNativeMedia {
	const plan = prepareNativeMediaPlanEnvelopeWithDeferredTimingReferencesV2(value).plan;
	if (plan.version !== 14) throw new TypeError('Owned OpenFX graph preparation requires an exact V14 plan.');
	const retained = INDICES.get(plan); if (retained) return retained;
	const effects = new Map<string, UnifiedExactRenderOpenFxNode[]>();
	for (const node of plan.nodes) if (node.kind === 'openfx') {
		const key = targetKey(node.state.context, node.state.attachment.targetId);
		const rows = effects.get(key) ?? []; rows.push(node); effects.set(key, rows);
	}
	const targets = new Map<string, Target>();
	for (const [key, rows] of effects) {
		const enabled = rows.filter(node => node.state.enabled);
		targets.set(key, Object.freeze({ effects: Object.freeze(rows), enabled: enabled.length > 0,
			inputs: Object.freeze([...new Set(enabled.flatMap(node => node.state.inputs.map(input => input.sourceRef)))]) }));
	}
	const index = Object.freeze({ plan,
		has: (context: OfxContext, targetId: string) => targets.get(targetKey(context, targetId))?.enabled === true,
		inputs: (context: OfxContext, targetId: string) => targets.get(targetKey(context, targetId))?.inputs ?? NO_INPUTS,
		effects: (context: OfxContext, targetId: string) => targets.get(targetKey(context, targetId))?.effects ?? NO_EFFECTS,
	});
	INDICES.set(plan, index); return index;
}

export function framescaperOwnedOpenFxGraphIndexNativeMedia(plan: UnifiedExactRenderPlanV14): FramescaperOwnedOpenFxGraphIndexNativeMedia | null {
	return INDICES.get(plan) ?? null;
}
function targetKey(context: OfxContext, targetId: string): string { return `${context}\0${targetId}`; }
