/* SPDX-License-Identifier: AGPL-3.0-only */
import { LOCAL_ASSISTANCE_ADDITIONAL_COPY as ENGLISH, LOCAL_ASSISTANCE_REVIEW_COPY_ALIASES } from '../../i18n/editor-local-assistance-additional-copy.ts';
import type { LocalAssistanceGuidedReviewChoice } from '../assistance/local-assistance-guided-result-review.ts';
import { formatLocalizedTemplate } from './localization-template.ts';

type Copy = Readonly<Record<string, string | undefined>>;
const KEYS: Readonly<Record<string, keyof typeof ENGLISH>> = Object.freeze({
	cleanup: 'localAssistanceChoiceCleanup', 'attributed-transcript': 'localAssistanceChoiceTranscript',
	'enhanced-audio': 'localAssistanceChoiceEnhancedDialogue', 'dereverberated-audio': 'localAssistanceChoiceReducedReverb',
	dialogue: 'localAssistanceChoiceDialogue', music: 'localAssistanceChoiceMusic', effects: 'localAssistanceChoiceEffects',
	reaction: 'localAssistanceChoiceReaction', 'transcript-index': 'localAssistanceChoiceTranscriptIndex',
	beat: 'localAssistanceChoiceBeat', 'beat-grid:tempo-map': 'localAssistanceChoiceTempoMap', cut: 'localAssistanceChoiceCut',
	'video-index': 'localAssistanceChoiceVideoIndex', 'reframe-path': 'localAssistanceChoiceReframe',
	highlight: 'localAssistanceChoiceHighlight', editorial: 'localAssistanceChoiceEditorial',
});
function text(copy: Copy, key: keyof typeof ENGLISH): string { return copy[`ui.localAssistance.${key}`] || copy[LOCAL_ASSISTANCE_REVIEW_COPY_ALIASES[key] ?? key] || ENGLISH[key]; }
export function localizedGuidedReviewChoice(choice: LocalAssistanceGuidedReviewChoice, copy: Copy, number: Intl.NumberFormat): string {
	const presentation = choice.presentation;
	if (!presentation) return choice.label;
	const key = presentation.kind === 'captions'
		? presentation.count === 1 ? 'localAssistanceChoiceCaptionOne' : 'localAssistanceChoiceCaptionOther'
		: KEYS[presentation.kind];
	return key ? formatLocalizedTemplate(text(copy, key), { count: number.format(presentation.count ?? 0), index: number.format(presentation.index ?? 0) }) : choice.label;
}
export function localizedEditorialProposal(index: number, copy: Copy, number: Intl.NumberFormat): string {
	return formatLocalizedTemplate(text(copy, 'localAssistanceEditorialProposal'), { index: number.format(index) });
}
