/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MasteringSequenceIssue } from '../../mastering-sequence.ts';
import type { SoundscaperMasteringSequenceCopy } from '../soundscaper-mastering-sequence-copy.ts';
const KEYS: Readonly<Record<MasteringSequenceIssue['code'], keyof SoundscaperMasteringSequenceCopy>> = Object.freeze({
	'mastering-sequence.region-missing': 'issueRegionMissing',
	'mastering-sequence.region-not-a-region': 'issueRegionNotARegion',
	'mastering-sequence.region-other-sequence': 'issueRegionOtherSequence',
	'mastering-sequence.fades-exceed-region': 'issueFadesExceedRegion',
	'mastering-sequence.order-diverges-from-timeline': 'issueOrderDiverges',
});
export function masteringSequenceIssueLabel(issue: MasteringSequenceIssue, copy: SoundscaperMasteringSequenceCopy): string { return copy[KEYS[issue.code]]; }
