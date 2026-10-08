/* SPDX-License-Identifier: AGPL-3.0-only */

export type RecoverySurface = 'project-recovery' | 'audacity-recovery' | 'take-cycle-recovery';

/** A completed recovery may close only the surface that started it. */
export function recoverySurfaceAfterClose(current: string | null, owner: RecoverySurface): string | null {
	return current === owner ? null : current;
}
