/* SPDX-License-Identifier: AGPL-3.0-only */
import { AUDIO_SELECTION_EFFECT_DEFINITIONS } from '../../../../effects.js';
import { normalizeEffectMacroStep } from '../../../../effect-macro-steps.ts';
import { isMacroCommandStep } from '../../../../macro-command-steps.ts';
import { selectionEffectChangesLength } from '../selection-effect-length.ts';
import type { EffectMacroRequestEffect } from './effect-macro-service.ts';

/** Time insertion affects selected silent lanes just as it does in ordinary Apply. */
export function macroNeedsSilentTargets(effects: readonly EffectMacroRequestEffect[]): boolean {
	return effects.some(effect => {
		if (isMacroCommandStep(effect)) return false;
		const normalized = normalizeEffectMacroStep(effect);
		return selectionEffectChangesLength(normalized.type, normalized.params, AUDIO_SELECTION_EFFECT_DEFINITIONS[normalized.type]);
	});
}
