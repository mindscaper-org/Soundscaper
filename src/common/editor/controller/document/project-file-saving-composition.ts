/* SPDX-License-Identifier: AGPL-3.0-only */

import { desktopOriginalFileFor, retainDesktopOriginalFile, releaseDesktopOriginalFile } from '../../desktop-original-file-port.ts';
import { browserProjectHandle, type ProjectFileTarget } from '../../file-save-stream.ts';
import { normalizeSavingPreferences, normalizeTemporaryDataPreferences, type SavingPreferences, type TemporaryDataPreferences } from '../../saving-preferences.ts';
import { createProjectFileSaving, releaseProjectFileWriteLease, type ProjectFileWriteLease } from './internal/project-file-saving.ts';
import type { NativeProjectDocument, NativeSavedFile } from './native-project-types.ts';
import { sameProjectSnapshot } from '../../storage/project-snapshot-equality.ts';
import { formatPresentationMessage } from '../../../i18n/presentation-message.ts';

export interface ProjectFileSavingRuntime {
	getOpenProjectIds(): readonly string[];
	getProjects(): readonly Readonly<{ project: NativeProjectDocument; readOnly: boolean }>[];
	getWritableProject(id: string): NativeProjectDocument | null;
	isProjectWritable(id: string): boolean;
	getPreferences(): SavingPreferences;
	getRetentionKey?(): string;
	isReady?(): boolean;
	acquireInactiveWrite?(id: string): Promise<ProjectFileWriteLease | null>;
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
	prepareOriginalOverwrite?(id: string, allowProjectSavePicker?: boolean): PromiseLike<unknown> | unknown;
	confirmProjectSave?(request: Record<string, string>): PromiseLike<unknown> | unknown;
	restoreProjectFile?(id: string): PromiseLike<unknown> | unknown;
	rememberProjectFile?(request: Readonly<{ projectId: string; originalId: string | null; baseline: string }>): PromiseLike<unknown> | unknown;
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
		getOpenProjectIds: runtime?.getOpenProjectIds ?? (() => { const project = d.getProject(); return project ? [project.id] : []; }),
		getProjects: runtime?.getProjects ?? (() => { const project = d.getProject(); return project ? [{ project, readOnly: false }] : []; }),
		getWritableProject: runtime?.getWritableProject ?? (id => { const project = d.getProject(); return project?.id === id ? project : null; }),
		isProjectWritable: runtime?.isProjectWritable ?? (id => d.getProject()?.id === id),
		getPreferences: runtime?.getPreferences ?? (() => normalizeSavingPreferences(undefined, d.fileService.isDesktop)),
		acquireInactiveWrite: runtime?.acquireInactiveWrite,
		activate: id => runtime?.activate(id), discard: id => runtime?.discard(id), flushInternal: d.flush, write: d.write,
		prepareOriginal: (original, allowProjectSavePicker) => d.fileService.prepareOriginalOverwrite?.(original.id, allowProjectSavePicker),
		ask: async project => {
			const copy = d.copy as Readonly<Record<string, string>>;
			const title = String(project.title ?? '');
			const displayTitle = title.length > 256 ? `${title.slice(0, 255).replace(/[\uD800-\uDBFF]$/u, '')}…` : title;
			const message = formatPresentationMessage(copy, {
				key: 'savingCloseMessage', fallback: 'Save changes to “{project}” before closing?',
				parameters: { project: displayTitle.replaceAll('\0', '\uFFFD') },
			});
			const result = await d.fileService.confirmProjectSave?.({
				title: copy.savingCloseTitle ?? 'Save project changes?', message,
				save: copy.savingSave ?? 'Save', discard: copy.savingDiscard ?? 'Discard', cancel: copy.savingCancel ?? 'Cancel',
			});
			return result === 'save' || result === 'discard' ? result : 'cancel';
		},
		restore: async id => {
			const value = await d.fileService.restoreProjectFile?.(id) as (ProjectFileTarget & { baseline?: string }) | null;
			if (!value || typeof value.baseline !== 'string') return null;
			if (value.originalFile) retainDesktopOriginalFile(value.originalFile);
			return { ...value, baseline: value.baseline };
		},
		remember: async (id, target, baseline) => {
			await d.fileService.rememberProjectFile?.({ projectId: id, originalId: target.originalFile?.id ?? null, baseline });
		}, release: async original => { await releaseDesktopOriginalFile(original); await d.fileService.releaseOriginalFile?.(original.id); }, handleError: error => runtime?.handleError(error),
	});
	let retentionRequest: Readonly<{ key: string }> | null = null, maintenance: Promise<unknown> = Promise.resolve();
	const unsubscribe = runtime?.subscribe(() => {
		if (runtime.isReady?.() === false) return;
		service.observe();
		const ids = runtime.getOpenProjectIds().join('\0');
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
	acquire(id: string): PromiseLike<ProjectFileWriteLease>;
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
	session: Readonly<{
		getSnapshot(): Readonly<{ tabs: readonly Readonly<{ projectId: string; readOnly?: boolean }>[] }>;
		getProject(id: string): Project;
	}>;
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
	type Snapshot = ReturnType<typeof d.session.getSnapshot>;
	type Tab = Snapshot['tabs'][number];
	type ProjectView = Readonly<{ project: Project; readOnly: boolean }>;
	type SnapshotViews = { readonly byId: Map<string, ProjectView>; all?: readonly ProjectView[] };
	const projectViews = new WeakMap<Snapshot, SnapshotViews>();
	function viewsFor(snapshot: Snapshot): SnapshotViews {
		let views = projectViews.get(snapshot);
		if (!views) { views = { byId: new Map() }; projectViews.set(snapshot, views); }
		return views;
	}
	function projectView(views: SnapshotViews, tab: Tab): ProjectView {
		let view = views.byId.get(tab.projectId);
		if (!view) {
			view = { project: d.session.getProject(tab.projectId), readOnly: Boolean(tab.readOnly) };
			views.byId.set(tab.projectId, view);
		}
		return view;
	}
	const getProjects = () => {
		const snapshot = d.session.getSnapshot();
		const views = viewsFor(snapshot);
		return views.all ??= snapshot.tabs.map(tab => projectView(views, tab));
	};
	const findTab = (snapshot: Snapshot, id: string) => snapshot.tabs.find(tab => tab.projectId === id);
	const getWritableProject = (id: string): Project | null => {
		const snapshot = d.session.getSnapshot();
		const tab = findTab(snapshot, id);
		return tab && !tab.readOnly ? projectView(viewsFor(snapshot), tab).project : null;
	};
	const isProjectWritable = (id: string): boolean => {
		const tab = findTab(d.session.getSnapshot(), id);
		return Boolean(tab && !tab.readOnly);
	};
	const getOpenProjectIds = () => d.session.getSnapshot().tabs.map(tab => tab.projectId);
	const isOpen = (id: string): boolean => Boolean(findTab(d.session.getSnapshot(), id));
	return {
		getProjects, getOpenProjectIds, getWritableProject, isProjectWritable, isReady: d.ready, getPreferences: () => d.preferences().saving, getRetentionKey: () => JSON.stringify(d.preferences().temporaryData), subscribe: d.subscribe, signal: d.signal, handleError: d.handleError,
		acquireInactiveWrite: async id => {
			const lock = await d.acquire(id);
			let retained = false;
			try {
				const expected = d.getPersistedProject?.(id);
				if (!lock.readOnly && expected && sameProjectSnapshot(await d.store.loadProject(id), expected) && !lock.readOnly) {
					retained = true;
					return lock;
				}
				return null;
			} finally { if (!retained) await releaseProjectFileWriteLease(lock); }
		},
		activate: id => {
			if (!isOpen(id)) throw new Error('The project is no longer open.');
			return d.switchProject(d.session.getProject(id));
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
				openIds: new Set(getOpenProjectIds()), isOpen, acquire: d.acquire,
				isCurrent: () => {
					const current = normalizeTemporaryDataPreferences(d.preferences().temporaryData);
					return !d.signal.aborted && current.limitProjects && current.maximumProjects === preferences.maximumProjects;
				},
			});
			if (changed) await d.refreshCatalog?.();
		},
	};
}
