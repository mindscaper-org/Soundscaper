/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem, type createDeliveryReport } from './delivery-report.ts';
import { parameterToLinearGain } from './dawproject-format.ts';
import type { DawprojectParameter } from './dawproject-import.ts';

/** A supported static fader can still exceed the native strip's gain range. */
export function dawprojectStaticGain(parameter: DawprojectParameter | null | undefined,
	draft: ReturnType<typeof createDeliveryReport>, scope: Readonly<Record<string, unknown>>): number {
	if (parameter?.value == null) return 1;
	const gain = parameterToLinearGain(parameter.value, parameter.unit) ?? 1;
	if (gain <= 4) return gain;
	addDeliveryReportItem(draft, {
		code: 'dawproject.static-gain-clamped', disposition: 'converted', severity: 'warning', scope,
		data: { authoredGain: Number.isFinite(gain) ? gain : String(gain), importedGain: 4, maximum: 4 },
		message: 'The static fader exceeds the native gain range and is limited to its maximum.',
	});
	return 4;
}
