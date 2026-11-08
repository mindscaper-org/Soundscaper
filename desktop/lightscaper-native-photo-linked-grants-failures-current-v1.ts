/* SPDX-License-Identifier: AGPL-3.0-only */
const CLEANUP = new WeakSet<object>(), QUARANTINE = new Set<object>();
export function retainLinkedGrantCleanupCurrentV1(owner: object): void { QUARANTINE.add(owner); }
export function rememberLinkedGrantFailureCurrentV1(errors: unknown[], error: unknown): void {
	if (!errors.some(value => Object.is(value, error))) errors.push(error);
}
export function combineLinkedGrantFailuresCurrentV1(errors: readonly unknown[], message: string): unknown {
	const distinct: unknown[] = []; for (const error of errors) rememberLinkedGrantFailureCurrentV1(distinct, error);
	return distinct.length === 1 ? distinct[0] : new AggregateError(distinct, message, { cause: distinct[0] });
}
/** Only actual owning native/file/SQLite retirement sites may mint this witness. */
export function createLinkedGrantCleanupFailureCurrentV1(errors: readonly unknown[], message: string): AggregateError {
	const distinct: unknown[] = []; for (const error of errors) rememberLinkedGrantFailureCurrentV1(distinct, error);
	const failure = new AggregateError(distinct, message, { cause: distinct[0] }); CLEANUP.add(failure); return failure;
}
export function linkedGrantCleanupIsUnprovedCurrentV1(value: unknown): boolean {
	return value !== null && typeof value === 'object' && CLEANUP.has(value);
}
