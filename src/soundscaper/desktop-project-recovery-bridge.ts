/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectRecoveryCandidate, ProjectRecoverySummary } from '../common/editor/storage/project-recovery-repository.ts';

export const SOUNDSCAPER_PROJECT_RECOVERY_CHANNELS = Object.freeze({
	list: 'soundscaper:v1:project-recovery:list', read: 'soundscaper:v1:project-recovery:read',
});
export interface SoundscaperDesktopProjectRecoveryBridge {
	listProjectRecoverySummaries(): Promise<readonly ProjectRecoverySummary[]>;
	readProjectRecoveryCandidates(projectId: string): Promise<readonly ProjectRecoveryCandidate[]>;
}

/** The separate read-only capability does not weaken normal project bundle admission. */
export function resolveSoundscaperDesktopProjectRecoveryBridge(): SoundscaperDesktopProjectRecoveryBridge | null {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'soundscaperProjectRecoveryDesktop');
	if (!descriptor) return null;
	if (!Object.hasOwn(descriptor, 'value') || !Object.isFrozen(descriptor.value)) throw new Error('The desktop recovery bridge is invalid.');
	const bridge = descriptor.value as Partial<SoundscaperDesktopProjectRecoveryBridge>;
	if (typeof bridge.listProjectRecoverySummaries !== 'function' || typeof bridge.readProjectRecoveryCandidates !== 'function') {
		throw new Error('The desktop recovery bridge is incomplete.');
	}
	return bridge as SoundscaperDesktopProjectRecoveryBridge;
}
