/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectRecoveryCandidate } from '../common/editor/storage/project-recovery-repository.ts';
import { validateSoundscaperProject } from './editor-project-validation.ts';

const fatalNames = new Set([
	'AbortError', 'EditorDisposedError', 'EditorStoreClosedError', 'EditorStoreBlockedError',
	'EditorStoreVersionStaleError', 'SecurityError', 'NotAllowedError', 'InvalidStateError', 'QuotaExceededError',
]);
const fatalCodes = new Set(['STORE_CLOSED', 'STORE_BLOCKED', 'STORE_VERSION_STALE']);

export function isSoundscaperRecoveryBlockedFailure(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return fatalNames.has(error.name) || ('code' in error && typeof error.code === 'string' && fatalCodes.has(error.code));
}

/** A retained snapshot alone does not establish that a failed operation encountered corruption. */
export function hasSoundscaperProjectRecoveryEvidence(rows: readonly ProjectRecoveryCandidate[], error: unknown): boolean {
	if (!rows.length || isSoundscaperRecoveryBlockedFailure(error)) return false;
	const current = rows.find((row) => row.kind === 'current');
	if (current) {
		try { validateSoundscaperProject(current.project); }
		catch { return true; }
	}
	return error instanceof Error && (error.name === 'MissingStartupProjectError'
		|| /Soundscaper desktop baseline immutable file (?:byte length changed|ended during verification|failed SHA-256 snapshot verification)/u.test(error.message)
		|| ('code' in error && error.code === 'ENOENT') || /ENOENT/u.test(error.message));
}
