/* SPDX-License-Identifier: AGPL-3.0-only */

export interface StartupProjectRecoveryNotice {
	readonly projectId: string;
	readonly message: string;
}

interface StartupProjectRuntime<Project> {
	readonly state: { startupProjectRecovery?: StartupProjectRecoveryNotice | null };
	readonly store: { loadProject(id: string, options: { signal: AbortSignal }): Promise<Project | null> };
	readonly lifetimeSignal: AbortSignal;
	openProject(project: Project): Promise<unknown>;
	newProject(options?: { skipFlush?: boolean }): Promise<unknown>;
	onStartupProjectFailure?(projectId: string, error: unknown): Promise<boolean>;
	isDisposedError(error: unknown): boolean;
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
	runtime.state.startupProjectRecovery = null;
	try {
		const saved = projectId
			? await guard(runtime.store.loadProject(projectId, { signal: runtime.lifetimeSignal }))
			: null;
		if (saved) await guard(runtime.openProject(saved));
		else {
			if (projectId && runtime.onStartupProjectFailure) {
				throw new MissingStartupProjectError('The current saved project is missing.');
			}
			await guard(runtime.newProject());
		}
		return false;
	} catch (error) {
		if (runtime.isDisposedError(error)) throw error;
		await guard(undefined);
		if (!projectId || !runtime.onStartupProjectFailure
			|| !await guard(runtime.onStartupProjectFailure(projectId, error))) {
			if (!(error instanceof MissingStartupProjectError)) throw error;
			await guard(runtime.newProject());
			return false;
		}
		runtime.state.startupProjectRecovery = Object.freeze({
			projectId,
			message: error instanceof Error ? error.message : String(error),
		});
		await guard(runtime.newProject({ skipFlush: true }));
		return true;
	}
}
