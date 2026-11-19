/* SPDX-License-Identifier: AGPL-3.0-only */

export const PROJECT_WRITE_FENCE_SETTING_PREFIX = 'project-write-fence:';

/** The settings row shared by project CAS and exact rollback. */
export function projectWriteFenceKey(projectId: string): string {
	if (typeof projectId !== 'string' || !projectId) throw new TypeError('A project ID is required for a write fence.');
	return `${PROJECT_WRITE_FENCE_SETTING_PREFIX}${projectId}`;
}
