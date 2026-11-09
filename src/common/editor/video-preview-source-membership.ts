/* SPDX-License-Identifier: AGPL-3.0-only */

interface Source { readonly id: unknown }
interface Project { readonly sources?: readonly Source[] }

/** Index stable source IDs for this preview build; mutable/custom inputs stay live. */
export function createVideoPreviewSourceMembership(project: Project): (sourceId: unknown) => boolean {
	const sourcesProperty = Object.getOwnPropertyDescriptor(project, 'sources');
	const sources: unknown = sourcesProperty?.value;
	if (Object.isFrozen(project) && sourcesProperty && Object.hasOwn(sourcesProperty, 'value')
		&& Array.isArray(sources) && Object.getPrototypeOf(sources) === Array.prototype
		&& Object.isFrozen(sources) && !Object.hasOwn(sources, 'some') && !Object.hasOwn(sources, Symbol.iterator)) {
		const ids = new Set<unknown>();
		let stable = true;
		for (let index = 0; index < sources.length; index++) {
			const item = Object.getOwnPropertyDescriptor(sources, index);
			const source: unknown = item?.value;
			if (!item || !Object.hasOwn(item, 'value') || !source || typeof source !== 'object') { stable = false; break; }
			const id = Object.getOwnPropertyDescriptor(source, 'id');
			if (!id || !Object.hasOwn(id, 'value') || id.writable || id.configurable || typeof id.value !== 'string') { stable = false; break; }
			ids.add(id.value);
		}
		if (stable) return sourceId => ids.has(sourceId);
	}
	return sourceId => Boolean(project.sources?.some(source => source.id === sourceId));
}
