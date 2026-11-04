/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ProjectRecoveryChange } from '../../project-recovery-reason.ts';
import { PROJECT_RECOVERY_COPY_BY_LOCALE } from '../../../i18n/editor-project-recovery-copy.ts';
import { projectRecoveryChangeCopyKey } from '../project-recovery-reason-key.ts';
export function projectRecoveryChangeLabel(change: ProjectRecoveryChange, copy: Readonly<Record<string, string>>): string {
	const key = projectRecoveryChangeCopyKey(change);
	return copy[key] || PROJECT_RECOVERY_COPY_BY_LOCALE.en[key];
}
