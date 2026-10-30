/* SPDX-License-Identifier: AGPL-3.0-only */

import { freezePresentationMessage, type LocalizedPresentationMessage } from '../i18n/presentation-message.ts';

export type FormatFileFailureFamily = 'dawproject' | 'sesx' | 'audacity-database' | 'scape' | 'legacy-aup'
	| 'cue' | 'edl' | 'labels' | 'effect-preset' | 'audacity-preset' | 'raw-pcm' | 'bext' | 'macro' | 'export-preset' | 'editor-input';
export interface FormatFileFailure {
	readonly family: FormatFileFailureFamily;
	readonly reason: string;
	readonly message: LocalizedPresentationMessage;
}
const failures = new WeakMap<Error, FormatFileFailure>();

/** Preserve exact diagnostics, subclasses and causes beside an application-owned primary explanation. */
export function withFormatFileFailure<Failure extends Error>(error: Failure, failure: FormatFileFailure): Failure {
	if (aborted(error, new Set<object>(), 0)) return error;
	failures.set(error, Object.freeze({ family: failure.family, reason: failure.reason,
		message: freezePresentationMessage(failure.message) }));
	return error;
}
export function formatFileFailure(error: unknown): FormatFileFailure | undefined {
	return error instanceof Error ? failures.get(error) : undefined;
}
export function formatFileFailureMessage(error: unknown): LocalizedPresentationMessage | undefined {
	return formatFileFailure(error)?.message;
}
function aborted(error: Error, seen: Set<object>, depth: number): boolean {
	if (depth > 16 || seen.has(error)) return false;
	seen.add(error);
	if (error.name === 'AbortError' || ('code' in error && error.code === 'ABORTED')) return true;
	const cause: unknown = Object.getOwnPropertyDescriptor(error, 'cause')?.value;
	return cause instanceof Error && aborted(cause, seen, depth + 1);
}
