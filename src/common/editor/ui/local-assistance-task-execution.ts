/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AssistanceGuidedWorkflowId } from '../assistance/workflow-recipes.ts';
import type { LocalAssistanceAudioEffectWorkflowId } from '../assistance/local-assistance-preparation.ts';
import type { LocalAssistanceGuidedSessionStore } from './local-assistance-guided-session-store.ts';

/** These effects have complete output choices fixed by the command the user chose. */
export function localAssistanceTaskAppliesDirectly(
	workflowId: AssistanceGuidedWorkflowId,
): workflowId is LocalAssistanceAudioEffectWorkflowId {
	return workflowId === 'enhance-dialogue' || workflowId === 'reduce-reverb'
		|| workflowId === 'separate-dialogue-music-effects';
}

/** Keep output authentication and the selection fence on the ordinary Apply path. */
export async function executeLocalAssistanceTask(
	store: LocalAssistanceGuidedSessionStore,
	workflowId: AssistanceGuidedWorkflowId,
): Promise<void> {
	await store.run();
	if (!localAssistanceTaskAppliesDirectly(workflowId) || !store.getSnapshot().canReview) return;
	await store.review();
	const reviewed = store.getSnapshot();
	if (reviewed.phase !== 'review-ready' || !reviewed.review) return;
	for (const choice of reviewed.review.choices) {
		if (choice.enabled) store.setReviewChoiceSelected(choice.id, true);
	}
	if (!store.getSnapshot().canAccept) throw new Error('The effect returned no applicable audio.');
	await store.accept();
}
