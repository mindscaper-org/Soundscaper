/* SPDX-License-Identifier: AGPL-3.0-only */
/** Semantic repair identity travels alongside the original diagnostic. */
export type ProjectRecoveryReasonCode = 'media-name-reset' | 'media-unavailable' | 'clip-media-unavailable'
	| 'bin-media-unavailable' | 'data-reset' | 'track-removed' | 'effect-removed' | 'take-media-unavailable' | 'references-reset';
export interface ProjectRecoveryChange {
	readonly path: string;
	readonly reason: string;
	readonly reasonCode?: ProjectRecoveryReasonCode;
}
