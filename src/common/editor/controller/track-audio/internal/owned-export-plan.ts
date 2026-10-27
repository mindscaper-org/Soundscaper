/* SPDX-License-Identifier: AGPL-3.0-only */

import { createExportPlan } from '../../../export.js';
import { captureOwnedExportPlan } from '../../../export-render-input-capture.ts';

/** The controller owns its PCM stem plans; generic public plan producers remain mutable. */
export function createControllerExportPlan(...args: Parameters<typeof createExportPlan>): ReturnType<typeof createExportPlan> {
	const plan = createExportPlan(...args);
	return plan.mode === 'stems' && (plan.format === 'wav' || plan.format === 'aiff') ? captureOwnedExportPlan(plan) : plan;
}
