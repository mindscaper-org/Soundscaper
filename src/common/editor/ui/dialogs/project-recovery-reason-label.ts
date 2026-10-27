/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ProjectRecoveryChange, ProjectRecoveryReasonCode } from '../../project-recovery-reason.ts';
import { PROJECT_RECOVERY_COPY_BY_LOCALE } from '../../../i18n/editor-project-recovery-copy.ts';
const KEYS = { 'media-name-reset': 'projectRecoveryMediaNameReset', 'media-unavailable': 'projectRecoveryMediaUnavailable',
	'clip-media-unavailable': 'projectRecoveryClipMediaUnavailable', 'bin-media-unavailable': 'projectRecoveryBinMediaUnavailable',
	'data-reset': 'projectRecoveryDataReset', 'track-removed': 'projectRecoveryTrackRemoved', 'effect-removed': 'projectRecoveryEffectRemoved',
	'take-media-unavailable': 'projectRecoveryTakeMediaUnavailable', 'references-reset': 'projectRecoveryReferencesReset',
} satisfies Record<ProjectRecoveryReasonCode, keyof typeof PROJECT_RECOVERY_COPY_BY_LOCALE.en>;
export function projectRecoveryChangeLabel(change: ProjectRecoveryChange, copy: Readonly<Record<string, string>>): string {
	const key = change.reasonCode ? KEYS[change.reasonCode] : 'projectRecoveryDataReset';
	return copy[key] || PROJECT_RECOVERY_COPY_BY_LOCALE.en[key];
}
