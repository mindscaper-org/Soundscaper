/* SPDX-License-Identifier: AGPL-3.0-only */

import { SCAPE_OPEN_REQUEST_TASK } from '../../scape-open-request-service.ts';
import type { ProjectSwitchLifetime } from '../../project-switch-service-types.ts';
import { SCAPE_INSPECTION_TASK } from '../scape/scape-inspection-service.ts';
import type { ScapeInspectionFence, ScapeInspectionQuiescence } from '../scape/scape-inspection-quiescence.ts';

export function beginProjectSwitchInspectionFence(
	quiescence: Pick<ScapeInspectionQuiescence, 'beginFence'>,
	lifetime: Pick<ProjectSwitchLifetime, 'cancelTask'>,
	preserveOpenRequest = false,
): ScapeInspectionFence {
	const reason = new DOMException('The editor task was superseded.', 'AbortError');
	const fence = quiescence.beginFence(reason);
	try {
		if (!preserveOpenRequest) lifetime.cancelTask(SCAPE_OPEN_REQUEST_TASK, reason);
		lifetime.cancelTask(SCAPE_INSPECTION_TASK, reason);
	} catch (error) {
		try { fence.release(); }
		catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Scape cancellation and activation-fence cleanup both failed.', { cause: error });
		}
		throw error;
	}
	return fence;
}
