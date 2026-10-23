/* SPDX-License-Identifier: AGPL-3.0-only */

/** Keep the canonical storage result; project publication can compact source metadata. */
export async function saveFencedProjectSnapshot<Project extends Readonly<{ id: string }>, Options>(
	save: (expected: Project, snapshot: Project, writeFence: string, options: Options) => Promise<unknown>,
	expected: Project,
	snapshot: Project,
	writeFence: string,
	options: Options,
): Promise<Project | null> {
	const saved = await save(expected, snapshot, writeFence, options);
	return requireSavedProjectSnapshot<Project>(saved, snapshot.id);
}

/** Retry an unpublished document only through the store's exact-absence admission. */
export async function createInitialProjectSnapshot<Project extends Readonly<{ id: string }>, Options>(
	create: (snapshot: Project, options: Options) => Promise<unknown>, snapshot: Project, options: Options,
): Promise<Project | null> {
	return requireSavedProjectSnapshot<Project>(await create(snapshot, options), snapshot.id);
}

function requireSavedProjectSnapshot<Project>(saved: unknown, projectId: string): Project | null {
	if (saved === null) return null;
	if (!saved || typeof saved !== 'object' || (saved as { id?: unknown }).id !== projectId) {
		throw new Error('Project storage returned an invalid saved snapshot.');
	}
	return saved as Project;
}
