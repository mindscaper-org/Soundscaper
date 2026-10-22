/* SPDX-License-Identifier: AGPL-3.0-only */

interface ExportOutputState {
	outputUrl: string | null;
	outputCleanup: (() => PromiseLike<unknown> | unknown) | null;
	exportOutput: unknown;
}

export interface ExportCompletionFailure { readonly error: unknown }

/** Retire an old download only after its replacement has successfully published. */
export async function retirePreviousExportOutput(state: ExportOutputState): Promise<ExportCompletionFailure | null> {
	const url = state.outputUrl;
	const cleanup = state.outputCleanup;
	state.outputUrl = null;
	state.outputCleanup = null;
	state.exportOutput = null;
	const failures: unknown[] = [];
	try { if (url) globalThis.URL?.revokeObjectURL?.(url); } catch (error) { failures.push(error); }
	try { await cleanup?.(); } catch (error) { failures.push(error); }
	return failures.length ? { error: failures.length === 1 ? failures[0]
		: new AggregateError(failures, 'Previous export output cleanup failed.') } : null;
}

/** A completed replacement remains available when retiring an older temporary file fails. */
export function reportExportOutputFailure(failure: ExportCompletionFailure | null, handleError: (error: unknown) => void): boolean {
	if (!failure) return false;
	handleError(failure.error);
	return true;
}
