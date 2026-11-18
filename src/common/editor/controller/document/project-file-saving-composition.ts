/* SPDX-License-Identifier: AGPL-3.0-only */

import { desktopOriginalFileFor, retainDesktopOriginalFile, releaseDesktopOriginalFile } from '../../desktop-original-file-port.ts';
import { browserProjectHandle, type ProjectFileTarget } from '../../file-save-stream.ts';
import { normalizeSavingPreferences, normalizeTemporaryDataPreferences, type SavingPreferences, type TemporaryDataPreferences } from '../../saving-preferences.ts';
import { createProjectFileSaving } from './internal/project-file-saving.ts';
import type { NativeProjectDocument, NativeSavedFile } from './native-project-types.ts';
import { sameProjectSnapshot } from '../../storage/project-snapshot-equality.ts';

export interface ProjectFileSavingRuntime {
	getProjects(): readonly Readonly<{ project: NativeProjectDocument; readOnly: boolean }>[];
	getPreferences(): SavingPreferences;
	getRetentionKey?(): string;
	isReady?(): boolean;
	activate(id: string): PromiseLike<unknown> | unknown;
	discard(id: string): PromiseLike<unknown> | unknown;
	subscribe(listener: () => void): () => void;
	readonly signal: AbortSignal;
	handleError(error: unknown): void;
	prune?(): Promise<unknown>;
}
export interface ProjectFileSavingPort {
	readonly isDesktop: boolean;
	releaseOriginalFile?(id: string): PromiseLike<unknown> | unknown;
	prepareOriginalOverwrite?(id: string): PromiseLike<unknown> | unknown;
	confirmProjectSave?(request: Record<string, string>): PromiseLike<unknown> | unknown;
	restoreProjectFile?(id: string): PromiseLike<unknown> | unknown;
	rememberProjectFile?(request: Readonly<{ projectId: string; originalId: string; baseline: string }>): PromiseLike<unknown> | unknown;
}

export function bindProjectFileSaving(d: Readonly<{
	runtime?: ProjectFileSavingRuntime;
	fileService: ProjectFileSavingPort;
	copy: object;
	getProject(): NativeProjectDocument | null;
	flush(): PromiseLike<unknown> | unknown;
	write(project: NativeProjectDocument, target: unknown, assertWritable: () => void): Promise<NativeSavedFile>;
}>) {
	const runtime = d.runtime;
	const service = createProjectFileSaving({
		desktop: d.fileService.isDesktop, getProject: d.getProject,
		getProjects: runtime?.getProjects ?? (() => { const project = d.getProject(); return project ? [{ project, readOnly: false }] : []; }),
		getPreferences: runtime?.getPreferences ?? (() => normalizeSavingPreferences(undefined, d.fileService.isDesktop)),
		activate: id => runtime?.activate(id), discard: id => runtime?.discard(id), flushInternal: d.flush, write: d.write,
		prepareOriginal: original => d.fileService.prepareOriginalOverwrite?.(original.id),
		ask: async project => {
			const copy = d.copy as Readonly<Record<string, string>>;
			const result = await d.fileService.confirmProjectSave?.({ title: copy.savingCloseTitle ?? 'Save project changes?',
				message: (copy.savingCloseMessage ?? 'Save changes to “{project}” before closing?').replace('{project}', String(project.title ?? '')), save: copy.savingSave ?? 'Save', discard: copy.savingDiscard ?? 'Discard', cancel: copy.savingCancel ?? 'Cancel' });
			return result === 'save' || result === 'discard' ? result : 'cancel';
		},
		restore: async id => {
			const value = await d.fileService.restoreProjectFile?.(id) as (ProjectFileTarget & { baseline?: string }) | null;
			if (!value || typeof value.baseline !== 'string') return null;
			if (value.originalFile) retainDesktopOriginalFile(value.originalFile);
			return { ...value, baseline: value.baseline };
		},
		remember: async (id, target, baseline) => {
			if (target.originalFile) await d.fileService.rememberProjectFile?.({ projectId: id, originalId: target.originalFile.id, baseline });
		}, release: async original => { await releaseDesktopOriginalFile(original); await d.fileService.releaseOriginalFile?.(original.id); }, handleError: error => runtime?.handleError(error),
	});
	let retentionRequest: Readonly<{ key: string }> | null = null, maintenance: Promise<unknown> = Promise.resolve();
	const unsubscribe = runtime?.subscribe(() => {
		if (runtime.isReady?.() === false) return;
		service.observe();
		const ids = runtime.getProjects().map(entry => entry.project.id).join('\0');
		const key = `${ids}:${runtime.getRetentionKey?.() ?? ''}`;
		if (!runtime.prune || key === retentionRequest?.key || !d.getProject()) return;
		const request = { key };
		retentionRequest = request;
		maintenance = maintenance.catch(() => undefined).then(() => runtime.prune?.());
		void maintenance.catch(error => {
			if (retentionRequest === request) retentionRequest = null;
			runtime.handleError(error);
		});
	});
	runtime?.signal.addEventListener('abort', () => { unsubscribe?.(); void service.dispose().catch(error => runtime.handleError(error)); }, { once: true });
	return Object.freeze({
		service,
		async opened(project: NativeProjectDocument, input: object): Promise<void> {
			const originalFile = desktopOriginalFileFor(input), fileHandle = browserProjectHandle(input);
			if (originalFile) retainDesktopOriginalFile(originalFile);
			await service.opened(project, { ...(originalFile ? { originalFile } : {}), ...(fileHandle ? { fileHandle } : {}) });
		},
		saved: (project: NativeProjectDocument, result: NativeSavedFile) => service.saved(project, result as ProjectFileTarget),
	});
}

interface TemporaryProjectRow { id: string; updatedAt?: unknown; revision?: unknown; title?: unknown }

export interface TemporaryProjectStore {
	listProjects(): PromiseLike<readonly TemporaryProjectRow[]>;
	loadProject(id: string): PromiseLike<unknown>;
	deleteProjectSnapshot(project: unknown): PromiseLike<boolean>;
}

/** Cap closed library copies; open sessions and a concurrently changed copy always survive. */
export async function pruneTemporaryProjects(d: Readonly<{
	store: TemporaryProjectStore;
	preferences?: TemporaryDataPreferences;
	openIds: ReadonlySet<string>;
	isOpen?(id: string): boolean;
	isCurrent?(): boolean;
	acquire(id: string): PromiseLike<Readonly<{ readOnly: boolean; release(): PromiseLike<unknown> | unknown }>>;
}>): Promise<boolean> {
	const preferences = normalizeTemporaryDataPreferences(d.preferences);
	if (!preferences.limitProjects) return false;
	const projects = [...await d.store.listProjects()].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
	const keepClosed = Math.max(0, preferences.maximumProjects - projects.filter(project => d.openIds.has(project.id)).length);
	const closed = projects.filter(project => !d.openIds.has(project.id));
	let changed = false;
	for (const project of closed.slice(keepClosed)) {
		if (d.isCurrent?.() === false) break;
		const lock = await d.acquire(project.id);
		try {
			if (lock.readOnly || d.openIds.has(project.id) || d.isOpen?.(project.id)) continue;
			const expected = await d.store.loadProject(project.id);
			if (d.isCurrent?.() === false) break;
			if (d.openIds.has(project.id) || d.isOpen?.(project.id)) continue;
			if (matchesTemporaryProject(expected, project) && await d.store.deleteProjectSnapshot(expected)) changed = true;
		} finally { await lock.release(); }
	}
	return changed;
}

function matchesTemporaryProject(value: unknown, row: TemporaryProjectRow): boolean {
	if (sameProjectSnapshot(value, row)) return true;
	if (!value || typeof value !== 'object' || 'tracks' in row || typeof row.revision !== 'number') return false;
	const project = value as Partial<TemporaryProjectRow>;
	return project.id === row.id && project.revision === row.revision
		&& project.updatedAt === row.updatedAt && project.title === row.title;
}

export function createControllerFileSavingRuntime<Project extends NativeProjectDocument>(d: Readonly<{
	session: Readonly<{ getSnapshot(): Readonly<{ tabs: readonly Readonly<{ projectId: string; readOnly?: boolean; history: Readonly<{ present: Project }> }>[] }> }>;
	store: TemporaryProjectStore;
	ready?(): boolean;
	preferences(): Readonly<{ saving: SavingPreferences; temporaryData: TemporaryDataPreferences }>;
	switchProject(project: Project): PromiseLike<unknown> | unknown;
	closeProject(id: string, options: { discard: boolean }): PromiseLike<unknown> | unknown;
	getPersistedProject?(id: string): Project | null;
	refreshCatalog?(): PromiseLike<unknown> | unknown;
	acquire: Parameters<typeof pruneTemporaryProjects>[0]['acquire'];
	subscribe: ProjectFileSavingRuntime['subscribe'];
	signal: AbortSignal;
	handleError: ProjectFileSavingRuntime['handleError'];
}>): ProjectFileSavingRuntime {
	const getProjects = () => d.session.getSnapshot().tabs.map(tab => ({ project: tab.history.present, readOnly: Boolean(tab.readOnly) }));
	const isOpen = (id: string): boolean => d.session.getSnapshot().tabs.some(tab => tab.projectId === id);
	return {
		getProjects, isReady: d.ready, getPreferences: () => d.preferences().saving, getRetentionKey: () => JSON.stringify(d.preferences().temporaryData), subscribe: d.subscribe, signal: d.signal, handleError: d.handleError,
		activate: id => {
			const tab = d.session.getSnapshot().tabs.find(tab => tab.projectId === id);
			if (!tab) throw new Error('The project is no longer open.');
			return d.switchProject(tab.history.present);
		},
		discard: async id => {
			const expected = d.getPersistedProject ? d.getPersistedProject(id) : await d.store.loadProject(id);
			await d.closeProject(id, { discard: true });
			if (isOpen(id)) throw new Error('The project is still open.');
			if (!expected) return;
			const lock = await d.acquire(id);
			try {
				if (lock.readOnly) throw new Error('The discarded project is in use.');
				if (isOpen(id)) throw new Error('The project is still open.');
				if (!await d.store.deleteProjectSnapshot(expected) && await d.store.loadProject(id)) {
					throw new Error('The discarded project changed before it could be removed.');
				}
			} finally { await lock.release(); }
			await d.refreshCatalog?.();
		},
		prune: async () => {
			const preferences = normalizeTemporaryDataPreferences(d.preferences().temporaryData);
			const changed = await pruneTemporaryProjects({ store: d.store, preferences,
				openIds: new Set(d.session.getSnapshot().tabs.map(tab => tab.projectId)), isOpen, acquire: d.acquire,
				isCurrent: () => {
					const current = normalizeTemporaryDataPreferences(d.preferences().temporaryData);
					return !d.signal.aborted && current.limitProjects && current.maximumProjects === preferences.maximumProjects;
				},
			});
			if (changed) await d.refreshCatalog?.();
		},
	};
}
