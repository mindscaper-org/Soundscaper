/* SPDX-License-Identifier: AGPL-3.0-only */
import type { LocalAssistanceGuidedReviewedResult, LocalAssistanceGuidedReviewChoice } from '../assistance/local-assistance-guided-result-review.ts';

/** Adapt the UI review at the explicit controller acceptance boundary. */
export function localAssistanceGuidedAcceptanceReview(review: LocalAssistanceGuidedReviewedResult): LocalAssistanceGuidedReviewedResult {
	if (!review.choices.some(choice => Object.hasOwn(choice, 'presentation'))) return review;
	const choices = review.choices.map(choice => {
		if (!Object.hasOwn(choice, 'presentation')) return choice;
		// Preserve every other field and descriptor for the controller's strict
		// schema checks; this boundary removes only the known UI decoration.
		const fields: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(choice);
		delete fields.presentation;
		return Object.freeze(Object.create(Object.getPrototypeOf(choice), fields) as LocalAssistanceGuidedReviewChoice);
	});
	const fields: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(review);
	fields.choices = { ...fields.choices, value: Object.freeze(choices) };
	return Object.freeze(Object.create(Object.getPrototypeOf(review), fields) as LocalAssistanceGuidedReviewedResult);
}
