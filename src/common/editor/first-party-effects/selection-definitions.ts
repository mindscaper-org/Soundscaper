/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUTO_TUNE_EFFECT_DEFINITION } from './auto-tune/definition.ts';
import { DEESSER_EFFECT_DEFINITION, MULTIBAND_COMPRESSOR_EFFECT_DEFINITION } from './dynamics/definition.ts';
import { STANDARD_FILTER_EFFECT_DEFINITIONS } from './standard/filters-definition.ts';
import { STANDARD_MODULATION_EFFECT_DEFINITIONS } from './standard/modulation-definition.ts';
import { NOISE_GATE_EFFECT_DEFINITION } from './standard/noise-gate-definition.ts';
import { STANDARD_DELAY_EFFECT_DEFINITION } from './standard/delay-definition.ts';
import { PHASE_CORRECTION_EFFECT_DEFINITION } from './phase-correction/definition.ts';

/** First-party selection registrations are separate from realtime rack admission. */
export const FIRST_PARTY_SELECTION_EFFECT_DEFINITIONS = Object.freeze({
	'auto-tune': AUTO_TUNE_EFFECT_DEFINITION,
	...STANDARD_FILTER_EFFECT_DEFINITIONS,
	...STANDARD_MODULATION_EFFECT_DEFINITIONS,
	'noise-gate': NOISE_GATE_EFFECT_DEFINITION,
	'multi-tap-delay': STANDARD_DELAY_EFFECT_DEFINITION,
	deesser: DEESSER_EFFECT_DEFINITION,
	'multiband-compressor': MULTIBAND_COMPRESSOR_EFFECT_DEFINITION,
	'automatic-phase-correction': PHASE_CORRECTION_EFFECT_DEFINITION,
});
