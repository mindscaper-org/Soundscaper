/* SPDX-License-Identifier: AGPL-3.0-only */
import { canonicalCopyValue, effectParameterCopyKey } from '../../i18n/canonical-extras.js';

type Copy = Readonly<Record<string, string>>;
type CopyOrLocale = Copy | string | undefined;
const LABEL_KEYS: Readonly<Record<string, string>> = Object.freeze({
	frequency: 'effectParamFrequency', threshold: 'effectParamThreshold', knee: 'effectParamKnee', ratio: 'effectParamRatio',
	attack: 'effectParamAttack', release: 'effectParamRelease', makeupGain: 'effectParamMakeupGain', ceiling: 'effectParamCeiling',
	lookahead: 'effectParamLookahead', hold: 'effectParamHold', rangeDb: 'effectParamRange', mix: 'effectParamMix',
	decay: 'effectParamDecay', preDelay: 'effectParamPreDelay', time: 'effectParamTime', feedback: 'effectParamFeedback',
});
export function effectParameterLabel(value: string, copy: Copy): string {
	return copy[Object.hasOwn(LABEL_KEYS, value) ? LABEL_KEYS[value]! : ''] || value.replace(/([a-z])([A-Z])/gu, '$1 $2').replace(/^./u, character => character.toUpperCase());
}
export function nativeEffectParameterLabel(type: string, name: string, copy: CopyOrLocale): string {
	const key = effectParameterCopyKey(type, name);
	const canonical = canonicalCopyValue(key, copy);
	return canonical !== key ? canonical : effectParameterLabel(name, (typeof copy === 'object' ? copy : {}) as Copy);
}
