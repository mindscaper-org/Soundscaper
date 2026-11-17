/* SPDX-License-Identifier: AGPL-3.0-only */
import { readSubprojectLinks, subprojectContentDigest, SUBPROJECT_DEPTH_LIMIT, type SubprojectLink } from '../../../../subprojects.ts';
import type { SubprojectDocument } from '../../subproject-actions.ts';

export interface ResolvedSubprojectNode {
	readonly project: SubprojectDocument;
	readonly digest: string;
	readonly children: readonly { readonly link: SubprojectLink; readonly node: ResolvedSubprojectNode | null }[];
}

type LoadProject = (id: string) => Promise<SubprojectDocument | null>;
type DigestProject = (project: SubprojectDocument, descendants: readonly string[]) => string;
const MAX_VISITED_NODES = 256;
const MAX_CACHED_DOCUMENTS = 32;

/** Share committed reads within one inspection. Publication starts a fresh inspection. */
export function cacheSubprojectDocumentReads(load: LoadProject): LoadProject {
	const reads = new Map<string, ReturnType<LoadProject>>();
	return id => {
		const cached = reads.get(id);
		if (cached) return cached;
		const pending = load(id);
		if (reads.size < MAX_CACHED_DOCUMENTS) reads.set(id, pending);
		return pending;
	};
}

/** A refresh reads detached saved documents and retains only their last descendant signature. */
export function cacheSubprojectDigests(): DigestProject {
	const signatures = new WeakMap<SubprojectDocument, { readonly descendants: readonly string[]; readonly digest: string }>();
	return (project, descendants) => {
		const previous = signatures.get(project);
		if (previous?.descendants.length === descendants.length
			&& descendants.every((digest, index) => digest === previous.descendants[index])) return previous.digest;
		const digest = subprojectContentDigest(project, descendants);
		signatures.set(project, { descendants, digest });
		return digest;
	};
}

/** Pinned links also participate in cycle admission, even though they do not refresh. */
export async function assertSubprojectGraphAcyclic(projectId: string, libraryId: string,
	load: LoadProject, ancestors: readonly string[], signal?: AbortSignal): Promise<void> {
	let count = 0;
	async function visit(id: string, path: readonly string[]): Promise<void> {
		signal?.throwIfAborted();
		if (path.includes(id)) throw new RangeError('Subproject dependency cycle detected.');
		if (path.length >= SUBPROJECT_DEPTH_LIMIT || ++count > MAX_VISITED_NODES) throw new RangeError('Subproject dependency depth or size exceeds its limit.');
		const project = await load(id);
		if (!project) return;
		for (const link of readSubprojectLinks(project)) if (link.libraryId === libraryId) await visit(link.projectId, [...path, id]);
	}
	await visit(projectId, ancestors);
}

/** Read only committed documents. Pinned or foreign links consume their installed PCM. */
export async function resolveSubprojectGraph(
	projectId: string,
	libraryId: string,
	load: LoadProject,
	ancestors: readonly string[] = [],
	signal?: AbortSignal,
	digestProject: DigestProject = subprojectContentDigest,
): Promise<ResolvedSubprojectNode> {
	let count = 0;
	async function visit(id: string, path: readonly string[]): Promise<ResolvedSubprojectNode> {
		signal?.throwIfAborted();
		if (path.includes(id)) throw new RangeError('Subproject dependency cycle detected.');
		if (path.length >= SUBPROJECT_DEPTH_LIMIT) throw new RangeError('Subproject nesting exceeds the supported depth.');
		if (++count > MAX_VISITED_NODES) throw new RangeError('Subproject dependency graph exceeds its limit.');
		const project = await load(id);
		signal?.throwIfAborted();
		if (!project || project.id !== id) throw new ReferenceError('A linked subproject is missing from this library.');
		if (project.schemaFamily !== 'soundscaper' || project.schemaVersion !== 1) throw new RangeError('Only current Soundscaper projects may be linked.');
		const children: ResolvedSubprojectNode['children'][number][] = [];
		for (const link of readSubprojectLinks(project)) {
			if (link.libraryId === libraryId && [...path, id].includes(link.projectId)) throw new RangeError('Subproject dependency cycle detected.');
			const node = link.followLatest && link.libraryId === libraryId ? await visit(link.projectId, [...path, id]) : null;
			children.push({ link, node });
		}
		return { project, children, digest: digestProject(project, children.map(({ link, node }) => node?.digest ?? link.contentDigest)) };
	}
	return visit(projectId, ancestors);
}
