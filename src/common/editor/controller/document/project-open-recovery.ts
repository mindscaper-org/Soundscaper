/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ProjectOpenRecoveryNotice {
	readonly projectId: string;
	readonly message: string;
	readonly requestId: number;
}

export interface ProjectOpenRecoveryRuntime {
	readonly state: { projectRecovery?: ProjectOpenRecoveryNotice | null };
	onProjectOpenFailure?(projectId: string, error: unknown): Promise<boolean>;
}

const blockedNames = new Set([
	'AbortError', 'EditorDisposedError', 'EditorStoreClosedError', 'EditorStoreBlockedError',
	'EditorStoreVersionStaleError', 'SecurityError', 'NotAllowedError', 'InvalidStateError', 'QuotaExceededError',
]);
const blockedCodes = new Set(['STORE_CLOSED', 'STORE_BLOCKED', 'STORE_VERSION_STALE', 'ABORTED', 'DISPOSED', 'PROJECT_CHANGED', 'QUOTA_EXCEEDED', 'REIMPORT_REQUIRED']);

export function isProjectOpenRecoveryBlocked(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return blockedNames.has(error.name) || ('code' in error && blockedCodes.has(String(error.code)));
}

/** All openers share one bounded recovery attempt; storage and ownership failures propagate. */
export async function withProjectOpenRecovery<Value>(
	open: () => PromiseLike<Value> | Value,
	recover: (error: unknown) => PromiseLike<{ readonly value: Value } | null>,
): Promise<Value> {
	try { return await open(); }
	catch (error) {
		if (isProjectOpenRecoveryBlocked(error)) throw error;
		const recovered = await recover(error);
		if (recovered) return recovered.value;
		throw error;
	}
}

/** Inspection is read-only. A new notice opens the existing recovery dialog for each current intent. */
export async function offerProjectOpenRecovery(
	runtime: ProjectOpenRecoveryRuntime,
	projectId: string,
	error: unknown,
	isCurrent: () => boolean = () => true,
): Promise<boolean> {
	if (!isCurrent() || isProjectOpenRecoveryBlocked(error) || !runtime.onProjectOpenFailure
		|| !await runtime.onProjectOpenFailure(projectId, error) || !isCurrent()) return false;
	runtime.state.projectRecovery = Object.freeze({
		projectId, message: error instanceof Error ? error.message : String(error),
		requestId: (runtime.state.projectRecovery?.requestId ?? 0) + 1,
	});
	return true;
}
