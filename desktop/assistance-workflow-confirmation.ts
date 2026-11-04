/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AssistanceWorkflowV1 } from '../src/common/editor/assistance/workflow.ts';

/** Ordinary selection effects are authorized by choosing their menu command. */
export function assistanceWorkflowRequiresConfirmation(request: Pick<AssistanceWorkflowV1, 'workflowId' | 'settings'>): boolean {
	const settings = request.settings;
	if (request.workflowId === 'enhance-dialogue' && settings.workflowId === 'enhance-dialogue'
		|| request.workflowId === 'reduce-reverb' && settings.workflowId === 'reduce-reverb') {
		return settings.placement !== 'replace-selection';
	}
	if (request.workflowId === 'separate-dialogue-music-effects'
		&& settings.workflowId === 'separate-dialogue-music-effects') {
		return settings.placement !== 'replace-selection';
	}
	return true;
}
