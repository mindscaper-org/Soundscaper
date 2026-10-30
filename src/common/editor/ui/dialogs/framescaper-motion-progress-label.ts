/* SPDX-License-Identifier: AGPL-3.0-only */
import { FRAMESCAPER_FINISHING_ADDITIONAL_COPY as FINISHING } from '../../../i18n/editor-framescaper-finishing-additional-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';
import type { FramescaperMotionAnalysisProgress } from '../../../../framescaper/editor-motion-analysis-actions-finishing.ts';
import { formatLocalizedTemplate } from '../localization-template.ts';
type Copy = Readonly<Record<string, string | undefined>>;
const MOTION_PHASES = { decoding: 'motionPhaseDecoding', tracking: 'motionPhaseTracking', publishing: 'motionPhasePublishing', complete: 'motionPhaseComplete' } as const;

export function motionProgressLabel(progress: FramescaperMotionAnalysisProgress, copy: Copy): string {
	const local = resolveEditorCopyScope('framescaperFinishing', FINISHING, copy);
	return formatLocalizedTemplate(local.motionProgress, { phase: local[MOTION_PHASES[progress.phase]], completed: progress.completed, total: progress.total });
}
