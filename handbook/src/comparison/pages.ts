/* SPDX-License-Identifier: AGPL-3.0-only */

export function isPairwiseComparisonPath(path: unknown): boolean {
	return typeof path === 'string'
		&& /\/src\/content\/docs\/start\/comparisons\/soundscaper-vs-[a-z0-9-]+\.md$/u.test(path.replaceAll('\\', '/'));
}

export function isComparisonPath(path: unknown): boolean {
	return isPairwiseComparisonPath(path) || typeof path === 'string'
		&& path.replaceAll('\\', '/').endsWith('/src/content/docs/start/how-soundscaper-compares.md');
}
