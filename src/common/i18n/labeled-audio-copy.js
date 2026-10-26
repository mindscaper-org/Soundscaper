/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Copy for the Edit > Labeled audio submenu ported from Audacity 3.
 *
 * The rows keep Audacity's short wording because the submenu already supplies
 * the context. They live behind their own seam for the same reason the
 * play-at-speed and export rows do: the main catalog sits at a maintainability
 * ceiling that a whole submenu should not push up.
 */
const LABELED_AUDIO_COPY_ENTRIES = Object.freeze([
	['labeledAudio', 'Labeled audio'],
	['labeledCut', 'Cut'],
	['labeledDelete', 'Delete'],
	['labeledCutLeaveGap', 'Cut and leave gap'],
	['labeledDeleteLeaveGap', 'Delete and leave gap'],
	['labeledSilence', 'Silence audio'],
	['labeledCopy', 'Copy'],
	['labeledSplit', 'Split'],
	['labeledJoin', 'Join'],
	['labeledDisjoin', 'Detach at silences'],
	[
		'noSilencesInLabels',
		'No separable silent regions were found inside the labelled audio.',
	],
	[
		'labeledAudioRequired',
		'Select a time range that contains at least one whole label.',
	],
]);

export const LABELED_AUDIO_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(LABELED_AUDIO_COPY_ENTRIES.map(([key, en]) => [key, en]))),
});
