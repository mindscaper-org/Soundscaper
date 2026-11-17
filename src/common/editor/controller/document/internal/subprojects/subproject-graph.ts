/* SPDX-License-Identifier: AGPL-3.0-only */
import { readSubprojectLinks, subprojectContentDigest, SUBPROJECT_DEPTH_LIMIT, type SubprojectLink } from '../../../../subprojects.ts';
import type { SubprojectDocument } from '../../subproject-actions.ts';

export interface ResolvedSubprojectNode {
	readonly project: SubprojectDocument;
	readonly digest: string;
	readonly children: readonly { readonly link: SubprojectLink; readonly node: ResolvedSubprojectNode | null }[];
}

/** Pinned links also participate in cycle admission, even though they do not refresh. */
export async function assertSubprojectGraphAcyclic(projectId: string, libraryId: string,
	load: (id: string) => Promise<SubprojectDocument | null>, ancestors: readonly string[], signal?: AbortSignal): Promise<void> {
	let count = 0;
	async function visit(id: string, path: readonly string[]): Promise<void> {
		signal?.throwIfAborted();
		if (path.includes(id)) throw new RangeError('Subproject dependency cycle detected.');
		if (path.length >= SUBPROJECT_DEPTH_LIMIT || ++count > 256) throw new RangeError('Subproject dependency depth or size exceeds its limit.');
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
	load: (id: string) => Promise<SubprojectDocument | null>,
	ancestors: readonly string[] = [],
	signal?: AbortSignal,
): Promise<ResolvedSubprojectNode> {
	let count = 0;
	async function visit(id: string, path: readonly string[]): Promise<ResolvedSubprojectNode> {
		signal?.throwIfAborted();
		if (path.includes(id)) throw new RangeError('Subproject dependency cycle detected.');
		if (path.length >= SUBPROJECT_DEPTH_LIMIT) throw new RangeError('Subproject nesting exceeds the supported depth.');
		if (++count > 256) throw new RangeError('Subproject dependency graph exceeds its limit.');
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
		return { project, children, digest: subprojectContentDigest(project, children.map(({ link, node }) => node?.digest ?? link.contentDigest)) };
	}
	return visit(projectId, ancestors);
}
