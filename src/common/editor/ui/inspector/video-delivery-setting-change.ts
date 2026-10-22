/* SPDX-License-Identifier: AGPL-3.0-only */

import { dialogSettingsFromDeliveryTarget } from '../export-preset-model.ts';

/** Explicit delivery choices replace imported automatic bounds for that axis. */
export function changeVideoDeliveryDialogSetting(
	settings: Readonly<Record<string, unknown>>,
	name: string,
	value: unknown,
): Readonly<Record<string, unknown>> {
	const patch = name === 'deliveryTarget' ? dialogSettingsFromDeliveryTarget(value) : null;
	const next = { ...settings, ...patch, [name]: value };
	if (name === 'canvasWidth' || name === 'canvasHeight'
		|| (patch?.canvasWidth != null && patch.canvasWidth !== '')) {
		next.canvasMaximumWidth = null;
		next.canvasMaximumHeight = null;
	}
	if (name === 'canvasFrameRate') {
		next.canvasFrameRateExact = null;
		next.canvasMaximumFrameRate = null;
	}
	return next;
}
