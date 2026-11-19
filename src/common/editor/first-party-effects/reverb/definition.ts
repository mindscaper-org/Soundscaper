/* SPDX-License-Identifier: AGPL-3.0-only */

type Range = [number, number, { unit: string; step: number; taper: string;
	automatable: false; automationBlockReason: string }];

/** Control metadata for the existing native convolution reverb. */
export const REVERB_EFFECT_DEFINITION = {
	defaults: { mix: .2, decay: 2, preDelay: .01 },
	ranges: {
		mix: [0, 1, { unit: 'ratio', step: .01, taper: 'linear', automatable: false, automationBlockReason: 'Reverb parameters currently rebuild the native effect graph.' }],
		decay: [.1, 10, { unit: 's', step: .01, taper: 'logarithmic', automatable: false, automationBlockReason: 'Reverb parameters currently rebuild the native effect graph.' }],
		preDelay: [0, 1, { unit: 's', step: .001, taper: 'linear', automatable: false, automationBlockReason: 'Reverb parameters currently rebuild the native effect graph.' }],
	} satisfies Record<string, Range>,
};
