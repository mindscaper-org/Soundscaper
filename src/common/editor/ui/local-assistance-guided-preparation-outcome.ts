/* SPDX-License-Identifier: AGPL-3.0-only */
import { validateAssistanceWorkflowReviewAuthorityV1, type AssistanceWorkflowReviewAuthorityV1 } from '../assistance/workflow-review-authority-v1.ts';
import { LOCAL_ASSISTANCE_GUIDED_PREPARATION_UNAVAILABLE_REASONS, type LocalAssistanceGuidedPreparationUnavailableReason } from '../assistance/local-assistance-preparation.ts';

/** Admit only the exact preparation result before the session retains custody. */
export function normalizePreparationOutcome(value: unknown): Readonly<{
	outcome: 'prepared'; workflow: unknown; reviewAuthority: AssistanceWorkflowReviewAuthorityV1;
}> | Readonly<{
	outcome: 'unavailable'; reason: LocalAssistanceGuidedPreparationUnavailableReason;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError('Guided preparation returned an invalid outcome.');
	}
	const row = value as Record<string, unknown>;
	if (row.outcome === 'prepared' && Object.keys(row).length === 3 && Object.hasOwn(row, 'workflow')
		&& Object.hasOwn(row, 'reviewAuthority')) {
		return Object.freeze({ outcome: 'prepared', workflow: row.workflow,
			reviewAuthority: validateAssistanceWorkflowReviewAuthorityV1(row.reviewAuthority) });
	}
	if (row.outcome === 'unavailable' && Object.keys(row).length === 2
		&& LOCAL_ASSISTANCE_GUIDED_PREPARATION_UNAVAILABLE_REASONS.includes(row.reason as LocalAssistanceGuidedPreparationUnavailableReason)) {
		return Object.freeze({ outcome: 'unavailable', reason: row.reason as LocalAssistanceGuidedPreparationUnavailableReason });
	}
	throw new TypeError('Guided preparation returned an invalid outcome.');
}
