/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SavingPreferences } from '../../../saving-preferences.ts';
import type { ProjectFileReference, ProjectFileTarget } from '../../../file-save-stream.ts';

type Awaitable<T> = PromiseLike<T> | T;
export type SaveDecision = 'save' | 'discard' | 'cancel';
export interface FileSavingProject { readonly id: string; readonly title?: unknown }
interface Entry extends ProjectFileTarget { baseline: Promise<string> | null }
interface Dependencies<Project extends FileSavingProject> {
	readonly desktop: boolean;
	readonly getProject: () => Project | null;
	readonly getProjects: () => readonly Readonly<{ project: Project; readOnly: boolean }>[];
	readonly getPreferences: () => SavingPreferences;
	readonly activate: (id: string) => Awaitable<unknown>;
	readonly flushInternal: () => Awaitable<unknown>;
	readonly write: (project: Project, target: unknown, assertWritable: () => void) => Promise<Readonly<Record<string, unknown>>>;
	readonly prepareOriginal: (original: ProjectFileReference) => Awaitable<unknown>;
	readonly ask: (project: Project) => Promise<SaveDecision>;
	readonly discard: (id: string) => Awaitable<unknown>;
	readonly restore?: (id: string) => Promise<(ProjectFileTarget & { baseline: string }) | null>;
	readonly remember?: (id: string, target: ProjectFileTarget, baseline: string) => Awaitable<unknown>;
	readonly release?: (reference: ProjectFileReference) => Awaitable<unknown>;
	readonly canSave?: () => boolean;
	readonly handleError: (error: unknown) => void;
	readonly schedule?: (callback: () => void, milliseconds: number) => number;
	readonly clear?: (timer: number) => void;
}

/** Track the file's committed content independently of the recovery library's dirty flag. */
export function createProjectFileSaving<Project extends FileSavingProject>(d: Dependencies<Project>) {
	const entries = new Map<string, Entry>();
	const loading = new Map<string, Promise<void>>();
	const timers = new Map<string, number>();
	let tail: Promise<unknown> = Promise.resolve(), disposed = false, closing = false;
	let observed: Project | null = null, autoSaving = d.getPreferences().autoSaving;
	const schedule = d.schedule ?? ((callback, ms) => Number(globalThis.setTimeout(callback, ms)));
	const clear = d.clear ?? (timer => globalThis.clearTimeout(timer));
	return Object.freeze({ opened, saved, save, observe, hasChanges, prepareClose, releaseCopyTarget, drain: () => tail, dispose });

	async function releaseCopyTarget(result: unknown): Promise<void> {
		const original = (result as ProjectFileTarget).originalFile;
		if (!original || [...entries.values()].some(entry => entry.originalFile?.id === original.id)) return;
		try { await d.release?.(original); } catch (error) { d.handleError(error); }
	}

	async function load(project: Project): Promise<void> {
		if (entries.has(project.id)) return;
		let operation = loading.get(project.id);
		if (!operation) {
			operation = (async () => {
				const restored = await d.restore?.(project.id);
				if (entries.has(project.id) || disposed || !d.getProjects().some(tab => tab.project.id === project.id)) {
					if (restored) await releaseCopyTarget(restored);
					return;
				}
				entries.set(project.id, restored ? { ...restored, baseline: Promise.resolve(restored.baseline) }
					: { baseline: emptyProject(project) ? fingerprint(project) : null });
			})();
			loading.set(project.id, operation);
		}
		try { await operation; } finally { loading.delete(project.id); }
	}
	async function opened(project: Project, target: ProjectFileTarget): Promise<void> {
		const previous = entries.get(project.id);
		entries.set(project.id, { ...target, baseline: fingerprint(project) });
		await remember(project.id);
		if (previous?.originalFile && previous.originalFile.id !== target.originalFile?.id) await d.release?.(previous.originalFile);
	}
	async function saved(project: Project, target: ProjectFileTarget): Promise<void> {
		const previous = entries.get(project.id);
		entries.set(project.id, { ...previous, ...target, baseline: fingerprint(project) });
		await remember(project.id);
		if (previous?.originalFile && target.originalFile && previous.originalFile.id !== target.originalFile.id) await d.release?.(previous.originalFile);
	}
	async function remember(id: string): Promise<void> {
		const entry = entries.get(id);
		if (entry?.baseline) await d.remember?.(id, entry, await entry.baseline);
	}
	async function hasChanges(project: Project): Promise<boolean> {
		await load(project);
		const baseline = entries.get(project.id)?.baseline;
		return !baseline || await baseline !== await fingerprint(project);
	}
	function enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = tail.catch(() => undefined).then(operation);
		tail = result; return result;
	}
	async function save(): Promise<boolean> {
		const project = d.getProject();
		if (!project || disposed) return false;
		return enqueue(async () => {
			if (disposed) return false;
			if (d.getProject()?.id === project.id) await d.flushInternal();
			const latest = d.getProjects().find(entry => entry.project.id === project.id);
			if (!latest || latest.readOnly) return false;
			return write(latest.project, true);
		});
	}
	async function write(project: Project, explicit: boolean): Promise<boolean> {
		await load(project);
		const entry = entries.get(project.id);
		if (!entry) return false;
		if (!explicit && !await hasChanges(project)) return true;
		const hasTarget = Boolean(entry.originalFile || entry.fileHandle);
		if (!hasTarget && !explicit) return true;
		const target = entry.originalFile ? await d.prepareOriginal(entry.originalFile) : entry.fileHandle;
		if (hasTarget && !target) throw new Error('The original project file is unavailable. Export a project file to choose a new destination.');
		const ownsDestination = () => !disposed && entries.get(project.id) === entry;
		const assertWritable = () => {
			if (!ownsDestination() || !d.getProjects().some(tab => tab.project.id === project.id && !tab.readOnly)) {
				throw new DOMException('The project lost write access before the file could be saved.', 'AbortError');
			}
		};
		assertWritable();
		const result = await d.write(project, target, assertWritable);
		if (result.cancelled === true) return false;
		if (ownsDestination() && d.getProjects().some(tab => tab.project.id === project.id)) {
			await saved(project, result as ProjectFileTarget);
		} else await releaseCopyTarget(result);
		return true;
	}
	function observe(): void {
		if (disposed || closing) return;
		const openIds = new Set(d.getProjects().map(entry => entry.project.id));
		for (const [id, entry] of entries) {
			if (openIds.has(id) || !entry.originalFile) continue;
			entries.delete(id);
			const timer = timers.get(id); if (timer) clear(timer); timers.delete(id);
			void Promise.resolve(d.release?.(entry.originalFile)).catch(d.handleError);
		}
		const project = d.getProject(), settings = d.getPreferences();
		if (observed === project && autoSaving === settings.autoSaving) return;
		observed = project; autoSaving = settings.autoSaving;
		if (!autoSaving) { for (const timer of timers.values()) clear(timer); timers.clear(); }
		if (!project) return;
		void load(project).catch(d.handleError);
		if (autoSaving) scheduleFileSave(project.id);
	}
	function scheduleFileSave(id: string): void {
		const existing = timers.get(id);
		if (existing !== undefined) clear(existing);
		timers.set(id, schedule(() => {
			timers.delete(id);
			void enqueue(async () => {
				if (disposed || !d.getPreferences().autoSaving || d.canSave?.() === false) return;
				const beforeFlush = d.getProjects().find(entry => entry.project.id === id);
				if (!beforeFlush || beforeFlush.readOnly) return;
				await load(beforeFlush.project);
				const entry = entries.get(id);
				if (!entry?.originalFile && !entry?.fileHandle) return;
				if (d.getProject()?.id === id) await d.flushInternal();
				if (disposed || !d.getPreferences().autoSaving || d.canSave?.() === false) return;
				const latest = d.getProjects().find(entry => entry.project.id === id);
				if (!latest || latest.readOnly) return;
				await write(latest.project, false);
			}).catch(d.handleError);
		}, 750));
	}
	async function prepareClose(projectId?: string): Promise<boolean> {
		if (closing) return false;
		closing = true;
		const paused: string[] = [];
		let prepared = false;
		let restoreSelection: Readonly<{ from: string; to: string }> | null = null;
		try {
			for (const [id, timer] of timers) {
				if (projectId && id !== projectId) continue;
				clear(timer);
				timers.delete(id);
				paused.push(id);
			}
			await tail.catch(() => undefined);
			if (!projectId || projectId === d.getProject()?.id) await d.flushInternal();
			if (d.getPreferences().autoSaving) {
				for (const { project, readOnly } of d.getProjects()) {
					if ((!projectId || project.id === projectId) && !readOnly) await enqueue(() => write(project, false));
				}
			}
			if (d.desktop && d.getPreferences().askBeforeClosing) {
				const discard: string[] = [];
				for (const { project, readOnly } of d.getProjects()) {
					if ((projectId && project.id !== projectId) || readOnly || !await hasChanges(project)) continue;
					const decision = await d.ask(project);
					if (decision === 'cancel') return false;
					if (decision === 'discard') discard.push(project.id);
					else {
						const activeId = d.getProject()?.id;
						if (activeId && activeId !== project.id) {
							const restoreId: string = restoreSelection?.from === activeId ? restoreSelection.to : activeId;
							restoreSelection = { from: project.id, to: restoreId };
							await d.activate(project.id);
						}
						if (d.getProject()?.id !== project.id || !await save()) return false;
					}
				}
				for (const id of discard) await d.discard(id);
			}
			prepared = true;
			return true;
		} finally {
			try {
				if (restoreSelection && d.getProject()?.id === restoreSelection.from
					&& d.getProjects().some(entry => entry.project.id === restoreSelection?.to)) {
					await d.activate(restoreSelection.to);
				}
			} finally {
				closing = false;
				observed = null;
				observe();
				if (!prepared && !disposed && d.getPreferences().autoSaving) {
					const openIds = new Set(d.getProjects().map(entry => entry.project.id));
					for (const id of paused) if (openIds.has(id) && !timers.has(id)) scheduleFileSave(id);
				}
			}
		}
	}
	async function dispose(): Promise<void> {
		disposed = true; for (const timer of timers.values()) clear(timer); timers.clear();
		await tail.catch(() => undefined);
		await Promise.all([...entries.values()].map(async entry => { if (entry.originalFile) await d.release?.(entry.originalFile); }));
		entries.clear();
	}
}

function emptyProject(project: FileSavingProject): boolean {
	const value = project as FileSavingProject & { tracks?: readonly { type?: unknown; labels?: readonly unknown[] }[]; clips?: readonly unknown[]; sources?: readonly unknown[]; timelineAnnotations?: readonly unknown[] };
	return !value.clips?.length && !value.sources?.length && !value.timelineAnnotations?.length
		&& (value.tracks?.length ?? 0) <= 1 && !value.tracks?.some(track => track.labels?.length || track.type === 'label' || track.type === 'video')
		&& !authoredTiming(project);
}
function authoredTiming(project: FileSavingProject): boolean {
	const value = project as FileSavingProject & {
		tempo?: { bpm?: number; timeSignature?: { numerator?: number; denominator?: number } };
		tempoMap?: { events?: readonly unknown[] };
		signatureMap?: { events?: readonly unknown[] };
	};
	return (value.tempo?.bpm ?? 120) !== 120 || (value.tempo?.timeSignature?.numerator ?? 4) !== 4
		|| (value.tempo?.timeSignature?.denominator ?? 4) !== 4
		|| (value.tempoMap?.events?.length ?? 0) > 1 || (value.signatureMap?.events?.length ?? 0) > 1;
}
async function fingerprint(project: FileSavingProject): Promise<string> {
	const content = Object.fromEntries(Object.entries(project).filter(([key]) => !['revision', 'updatedAt', 'createdAt', 'selection', 'playheadFrame'].includes(key)));
	const bytes = new TextEncoder().encode(JSON.stringify(content, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : value));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
