/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAddTrackCommand, createAddClipCommand } from '../../commands/factories.ts';
import type { AudioEditorCommand } from '../../commands/protocol.ts';
import { readSubprojectLinks, type SubprojectLink } from '../../subprojects.ts';
import { assertSubprojectGraphAcyclic, cacheSubprojectDigests, cacheSubprojectDocumentReads, MissingSubprojectError, resolveSubprojectGraph, type ResolvedSubprojectNode } from './internal/subprojects/subproject-graph.ts';
import { createSubprojectRenderer, type SubprojectRendererRuntime } from './internal/subprojects/subproject-renderer.ts';
import { EditorProjectChangedError, type EditorProjectToken } from '../shared/lifecycle.ts';

export function createStoredSubprojectActions(runtime: Omit<SubprojectRuntime, 'plan' | 'render'> & {
	readonly renderer: SubprojectRendererRuntime;
}) {
	return createSubprojectActions({ ...runtime, ...createSubprojectRenderer(runtime.renderer) });
}

export interface SubprojectDocument extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
	readonly schemaFamily?: unknown;
	readonly schemaVersion: number;
	readonly sampleRate: number;
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly Readonly<Record<string, unknown>>[];
}
export interface SubprojectGeometry { readonly sampleRate: number; readonly channelCount: number; readonly frameCount: number }
export interface SubprojectRenderedSource {
	readonly source: Readonly<Record<string, unknown>>;
	/** Releases only unpublished bytes belonging to this operation. */
	discard(): Promise<void>;
}
export interface SubprojectRuntime {
	getProject(): SubprojectDocument | null;
	assertWritable(): void;
	captureGeneration?(): EditorProjectToken;
	assertGeneration?(token: EditorProjectToken): void;
	loadProject(id: string): Promise<SubprojectDocument | null>;
	listProjects(): Promise<readonly { readonly id: string; readonly title?: unknown; readonly schemaFamily?: unknown }[]>;
	getLibraryId(): Promise<string>;
	commit(command: AudioEditorCommand): unknown;
	createId(prefix: string): string;
	openProject(id: string): Promise<unknown>;
	prepare(): Promise<unknown>;
	plan(project: SubprojectDocument, sampleRate: number): SubprojectGeometry;
	render(node: ResolvedSubprojectNode, geometry: SubprojectGeometry, signal?: AbortSignal): Promise<SubprojectRenderedSource>;
	reportError(error: unknown): void;
	wait(signal: AbortSignal): Promise<void>;
}

/** Owns exact parent publication; rendering never obtains another project's write lock. */
export function createSubprojectActions(runtime: SubprojectRuntime) {
	let queue: Promise<unknown> = Promise.resolve();
	const installed = new Map<string, string>();
	const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
		const next = queue.then(operation); queue = next.catch(() => undefined); return next;
	};
	function requireProject(): SubprojectDocument {
		runtime.assertWritable();
		const project = runtime.getProject();
		if (project?.schemaFamily !== 'soundscaper') throw new RangeError('Subprojects require an editable Soundscaper project.');
		return project;
	}
	function captureFence(signal?: AbortSignal) {
		const projectId = requireProject().id;
		const generation = runtime.captureGeneration?.();
		return (expected?: SubprojectDocument): SubprojectDocument => {
			signal?.throwIfAborted();
			if (generation) runtime.assertGeneration?.(generation);
			const current = requireProject();
			if (current.id !== projectId) throw new EditorProjectChangedError();
			if (expected && expected !== current) throw new DOMException('The parent project changed while rendering its subproject.', 'AbortError');
			return current;
		};
	}
	async function admitGraph(id: string, libraryId: string, parentId: string, signal?: AbortSignal): Promise<ResolvedSubprojectNode> {
		const load = cacheSubprojectDocumentReads(runtime.loadProject);
		await assertSubprojectGraphAcyclic(id, libraryId, load, [parentId], signal);
		return resolveSubprojectGraph(id, libraryId, load, [parentId], signal);
	}
	async function publish(project: SubprojectDocument, expected: SubprojectLink | null,
		node: ResolvedSubprojectNode, geometry: SubprojectGeometry, libraryId: string, assertCurrent: ReturnType<typeof captureFence>,
		signal?: AbortSignal, relink = false): Promise<void> {
		const rendered = await runtime.render(node, geometry, signal);
		let committed = false;
		try {
			assertCurrent(project);
			const current = await admitGraph(node.project.id, libraryId, project.id, signal);
			assertCurrent(project);
			if (current.digest !== node.digest) throw new DOMException('The saved subproject changed before publication.', 'AbortError');
			const link: SubprojectLink = { ...geometry, id: expected?.id ?? runtime.createId('subproject'),
				projectId: node.project.id, libraryId, title: node.project.title.slice(0, 256),
				sourceId: String(rendered.source.id), revision: node.project.revision, contentDigest: node.digest,
				followLatest: expected?.followLatest ?? true };
			const install: AudioEditorCommand = relink && expected ? { type: 'subproject/relink', expected, link, source: rendered.source }
				: { type: 'subproject/install', expected, link, source: rendered.source };
			if (expected) runtime.commit(install);
			else {
				const trackId = runtime.createId('track');
				const selection = project.selection as { startFrame?: number } | undefined;
				runtime.commit({ type: 'batch', commands: [install,
					createAddTrackCommand({ id: trackId, type: 'audio', name: link.title }, project.sampleRate),
					createAddClipCommand(trackId, { id: runtime.createId('clip'), sourceId: link.sourceId,
						timelineStartFrame: selection?.startFrame ?? 0, sourceStartFrame: 0, durationFrames: geometry.frameCount }),
				] });
			}
			committed = true;
			installed.set(`${project.id}:${link.id}`, node.digest);
		} finally { if (!committed) await rendered.discard(); }
	}
	async function refresh(options: { readonly id?: string; readonly force?: boolean; readonly signal?: AbortSignal },
		assertCurrent: ReturnType<typeof captureFence>): Promise<void> {
		const original = assertCurrent(), libraryId = await runtime.getLibraryId();
		assertCurrent(original);
		let load = cacheSubprojectDocumentReads(runtime.loadProject);
		let digestProject = cacheSubprojectDigests();
		for (const initial of readSubprojectLinks(original)) {
			if (options.id && initial.id !== options.id) continue;
			const project = assertCurrent();
			const link = readSubprojectLinks(project).find(candidate => candidate.id === initial.id);
			if (!link || (!link.followLatest && !options.force)) continue;
			if (link.libraryId !== libraryId) {
				if (options.force) throw new RangeError('This subproject belongs to another library. Relink it explicitly to resume updates.');
				continue;
			}
			let node: ResolvedSubprojectNode;
			try {
				node = await resolveSubprojectGraph(link.projectId, libraryId, load, [project.id], options.signal, digestProject);
			} catch (error) {
				if (!options.force && error instanceof MissingSubprojectError) continue;
				throw error;
			}
			assertCurrent(project);
			if (!options.force && (node.digest === link.contentDigest || installed.get(`${project.id}:${link.id}`) === node.digest)) continue;
			await publish(project, link, node, link, libraryId, assertCurrent, options.signal);
			load = cacheSubprojectDocumentReads(runtime.loadProject);
			digestProject = cacheSubprojectDigests();
		}
	}
	return Object.freeze({
		libraryId: () => runtime.getLibraryId(),
		async candidates() {
			const assertCurrent = captureFence();
			const projects = await runtime.listProjects();
			const id = assertCurrent().id;
			return projects.filter(project => project.id !== id && project.schemaFamily === 'soundscaper')
				.map(project => ({ id: project.id, title: String(project.title ?? project.id) }));
		},
		async add(projectId: string) {
			const assertCurrent = captureFence();
			await enqueue(async () => {
				assertCurrent();
				await runtime.prepare();
				const project = assertCurrent();
				const libraryId = await runtime.getLibraryId();
				const node = await admitGraph(projectId, libraryId, project.id);
				assertCurrent(project);
				await publish(project, null, node, runtime.plan(node.project, project.sampleRate), libraryId, assertCurrent);
			});
		},
		async refresh(options: Parameters<typeof refresh>[0] = {}) {
			const assertCurrent = captureFence(options.signal);
			await enqueue(() => refresh(options, assertCurrent));
		},
		async relink(id: string, projectId: string) {
			const assertCurrent = captureFence();
			await enqueue(async () => {
				const project = assertCurrent();
				const expected = readSubprojectLinks(project).find(link => link.id === id);
				if (!expected) throw new ReferenceError('Unknown subproject.');
				const libraryId = await runtime.getLibraryId();
				const node = await admitGraph(projectId, libraryId, project.id);
				assertCurrent(project);
				await publish(project, expected, node, expected, libraryId, assertCurrent, undefined, true);
			});
		},
		async follow(id: string, followLatest: boolean): Promise<void> {
			const assertCurrent = captureFence();
			const project = assertCurrent();
			const link = readSubprojectLinks(project).find(candidate => candidate.id === id);
			if (!link) throw new ReferenceError('Unknown subproject.');
			if (followLatest) {
				const libraryId = await runtime.getLibraryId();
				if (link.libraryId !== libraryId) throw new RangeError('Relink this subproject to the current library before following changes.');
				await admitGraph(link.projectId, libraryId, project.id);
				assertCurrent(project);
			}
			installed.delete(`${requireProject().id}:${id}`);
			runtime.commit({ type: 'subproject/follow', expected: link, followLatest });
		},
		detach(id: string): void {
			const link = readSubprojectLinks(requireProject()).find(candidate => candidate.id === id);
			if (!link) throw new ReferenceError('Unknown subproject.');
			runtime.commit({ type: 'subproject/detach', expected: link });
		},
		async open(id: string): Promise<unknown> {
			const assertCurrent = captureFence();
			const project = assertCurrent();
			const link = readSubprojectLinks(project).find(candidate => candidate.id === id);
			if (!link) throw new ReferenceError('Unknown subproject.');
			if (link.libraryId !== await runtime.getLibraryId()) throw new RangeError('The editable subproject belongs to another library.');
			assertCurrent(project);
			return runtime.openProject(link.projectId);
		},
		async watch(signal: AbortSignal): Promise<void> {
			const projectId = requireProject().id;
			const assertCurrent = captureFence(signal);
			let lastError = '';
			while (!signal.aborted && runtime.getProject()?.id === projectId) {
				try { await enqueue(() => refresh({ signal }, assertCurrent)); lastError = ''; }
				catch (error) {
					if (signal.aborted || error instanceof EditorProjectChangedError) return;
					if (error instanceof DOMException && error.name === 'AbortError') { /* Retry the next saved generation. */ }
					else if (String(error) !== lastError) { lastError = String(error); runtime.reportError(error); }
				}
				try { await runtime.wait(signal); } catch { return; }
			}
		},
	});
}

type SubprojectActions = ReturnType<typeof createSubprojectActions>;
export type SubprojectActionFacade = { readonly [Key in keyof SubprojectActions]:
	(...args: Parameters<SubprojectActions[Key]>) => Promise<Awaited<ReturnType<SubprojectActions[Key]>>>
};
