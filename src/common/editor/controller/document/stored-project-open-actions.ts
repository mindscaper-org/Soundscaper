/* SPDX-License-Identifier: AGPL-3.0-only */
import { createLocalizedError } from '../../../i18n/presentation-message.ts';
import { offerProjectOpenRecovery, withProjectOpenRecovery, type ProjectOpenRecoveryRuntime } from './project-open-recovery.ts';

interface StoredProject {
	readonly id: string;
}

interface StoredProjectTab<Project extends StoredProject> {
	readonly history: Readonly<{ readonly present: Project }>;
}

interface StoredProjectOpenOptions {
	readonly adoptSessionRevision?: boolean;
}

export interface StoredProjectOpenRuntime<Project extends StoredProject> extends ProjectOpenRecoveryRuntime {
	readonly copy: Readonly<{ readonly projectNotFound: string }>;
	readonly state: Readonly<{
		readonly recentProjectIds: readonly string[];
		readonly projects: readonly Readonly<{ readonly id: string }>[];
		readonly projectQueue?: Promise<void>;
		projectRecovery?: ProjectOpenRecoveryRuntime['state']['projectRecovery'];
	}>;
	readonly store: Readonly<{ loadProject(projectId: string): Promise<Project | null> }>;
	sessionTab(projectId: string): StoredProjectTab<Project> | null;
	switchProject(project: Project, options?: StoredProjectOpenOptions): PromiseLike<unknown> | unknown;
	openProject(project: unknown): PromiseLike<unknown> | unknown;
	publishProjectState?(): void;
	assertActive?(): void;
	getProjectId?(): string | null;
	hasMissingTimelineSources?(): boolean;
}

/** Owns the intent spanning asynchronous stored-project loads. */
export function createStoredProjectOpenActions<Project extends StoredProject>(
	runtime: StoredProjectOpenRuntime<Project>,
) {
	let requestGeneration = 0;
	function openWithRecovery(projectId: string | null, operation: (
		isCurrent: () => boolean, activate: (open: () => PromiseLike<unknown> | unknown) => Promise<unknown>,
	) => Promise<unknown>): Promise<unknown> {
		const generation = ++requestGeneration;
		let activationQueue = runtime.state.projectQueue, activationStarted = false;
		const previousProjectId = runtime.getProjectId?.();
		let expectedProjectId = previousProjectId;
		const isCurrent = (): boolean => {
			runtime.assertActive?.();
			return generation === requestGeneration && activationQueue === runtime.state.projectQueue
				&& expectedProjectId === runtime.getProjectId?.();
		};
		const activate = async (open: () => PromiseLike<unknown> | unknown): Promise<unknown> => {
			activationStarted = true;
			const result = await open();
			if (runtime.hasMissingTimelineSources?.()) throw new Error('The opened project contains missing or unreadable media.');
			return result;
		};
		return withProjectOpenRecovery(() => operation(isCurrent, activate), async (error) => {
			if (activationStarted) {
				const currentId = runtime.getProjectId?.();
				if (currentId !== previousProjectId && currentId !== projectId) return { value: null };
				activationQueue = runtime.state.projectQueue;
				expectedProjectId = currentId;
			}
			if (!isCurrent()) return { value: null };
			if (!projectId || !await offerProjectOpenRecovery(runtime, projectId, error, isCurrent)) {
				return isCurrent() ? null : { value: null };
			}
			runtime.publishProjectState?.();
			return { value: null };
		});
	}

	async function activate(
		projectId: string,
		options: StoredProjectOpenOptions = {},
	): Promise<unknown> {
		return openWithRecovery(projectId, async (isCurrent, activateProject) => {
			const openTab = runtime.sessionTab(projectId);
			if (openTab) return activateProject(() => options.adoptSessionRevision === true
				? runtime.switchProject(openTab.history.present, { adoptSessionRevision: true })
				: runtime.switchProject(openTab.history.present));
			const saved = await runtime.store.loadProject(projectId);
			if (!isCurrent()) return null;
			if (!saved) throw Object.assign(createLocalizedError(Error, runtime.copy, 'projectNotFound'), { name: 'MissingProjectError' });
			return activateProject(() => runtime.openProject(saved));
		});
	}

	return Object.freeze({
		open(project: unknown): Promise<unknown> {
			const id: unknown = project && typeof project === 'object' ? Object.getOwnPropertyDescriptor(project, 'id')?.value : null;
			return openWithRecovery(typeof id === 'string' ? id : null, async (_isCurrent, activateProject) => activateProject(() => runtime.openProject(project)));
		},
		async openRecent(projectId: string | null = null): Promise<unknown> {
			if (projectId === null) {
				return runtime.state.recentProjectIds
					.map((id) => runtime.state.projects.find((candidate) => candidate.id === id))
					.filter(Boolean);
			}
			if (!runtime.state.recentProjectIds.includes(projectId)) {
				throw createLocalizedError(Error, runtime.copy, 'projectNotFound');
			}
			return activate(projectId);
		},
		openById: activate,
	});
}
