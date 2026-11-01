/* SPDX-License-Identifier: AGPL-3.0-only */

import { offerProjectOpenRecovery, withProjectOpenRecovery, type ProjectOpenRecoveryRuntime } from '../../project-open-recovery.ts';

interface StartupProjectRuntime<Project> extends ProjectOpenRecoveryRuntime {
	readonly store: { loadProject(id: string, options: { signal: AbortSignal }): Promise<Project | null> };
	readonly lifetimeSignal: AbortSignal;
	openProject(project: Project): Promise<unknown>;
	newProject(options?: { skipFlush?: boolean }): Promise<unknown>;
	isDisposedError(error: unknown): boolean;
	hasMissingTimelineSources?(): boolean;
}

class MissingStartupProjectError extends Error {
	constructor(message: string) { super(message); this.name = 'MissingStartupProjectError'; }
}

/** A damaged working copy stays untouched while the user chooses a recovery candidate. */
export async function openStartupProject<Project>(
	runtime: StartupProjectRuntime<Project>,
	projectId: string | null,
	guard: <Value>(value: PromiseLike<Value> | Value) => Promise<Value>,
): Promise<boolean> {
	runtime.state.projectRecovery = null;
	return withProjectOpenRecovery(async () => {
		const saved = projectId
			? await guard(runtime.store.loadProject(projectId, { signal: runtime.lifetimeSignal }))
			: null;
		if (saved) {
			await guard(runtime.openProject(saved));
			if (runtime.hasMissingTimelineSources?.()) throw new Error('The opened project contains missing or unreadable media.');
		}
		else {
			if (projectId && runtime.onProjectOpenFailure) {
				throw new MissingStartupProjectError('The current saved project is missing.');
			}
			await guard(runtime.newProject());
		}
		return false;
	}, async (error) => {
		if (runtime.isDisposedError(error)) throw error;
		await guard(undefined);
		if (!projectId || !await guard(offerProjectOpenRecovery(runtime, projectId, error, () => {
			if (runtime.lifetimeSignal.aborted) throw runtime.lifetimeSignal.reason;
			return true;
		}))) {
			if (!(error instanceof MissingStartupProjectError)) throw error;
			await guard(runtime.newProject());
			return { value: false };
		}
		await guard(runtime.newProject({ skipFlush: true }));
		return { value: true };
	});
}
