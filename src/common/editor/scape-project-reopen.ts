/* SPDX-License-Identifier: AGPL-3.0-only */

/** Recognize archive-side conflicts without eagerly loading the archive digest implementation. */
export function isScapeProjectReopenConflict(error: unknown): boolean {
	return error instanceof Error && error.name === 'ScapeProjectReopenConflictError'
		&& 'code' in error && error.code === 'PROJECT_CHANGED';
}
export function hasMatchingScapeProjectDigests(inspection: Readonly<{
	projectCanonicalSha256?: unknown;
	existingProjectCanonicalSha256?: unknown;
}>): boolean {
	return typeof inspection.projectCanonicalSha256 === 'string'
		&& /^[a-f0-9]{64}$/u.test(inspection.projectCanonicalSha256)
		&& inspection.projectCanonicalSha256 === inspection.existingProjectCanonicalSha256;
}
