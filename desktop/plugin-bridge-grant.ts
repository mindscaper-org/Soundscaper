/* SPDX-License-Identifier: AGPL-3.0-only */

import { HelperContractViolationError } from './helper-wire-admission.ts';

export function pluginBridgeGrant(value: unknown, format: unknown): Readonly<{ windowsX86Vst2?: true }> {
	if (value === undefined) return Object.freeze({});
	if (value !== true || format !== 'vst2') {
		throw new HelperContractViolationError('unsafe-grant', 'Only VST2 grants may explicitly enable the Windows x86 bridge.');
	}
	return Object.freeze({ windowsX86Vst2: true });
}
