/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { FRAMESCAPER_PROJECT_SCHEMA_FAMILY, classifyProjectSchemaIdentity } from '../common/editor/project-schema-identity.ts';
import {
	bindProductVideoVisualPreviewRuntime,
	createProductVideoVisualPreviewRuntime,
	productVideoVisualPreviewRuntimeFor,
	type ProductVideoVisualPreviewRuntime,
} from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';

const inheritedRuntimes = new WeakMap<ProductVideoVisualPreviewRuntime, ProductVideoVisualPreviewRuntime | null>();

/** Bind lazy authenticated timelineImage image preview, Project Bin, and filmstrip routes. */
export function bindFramescaperSelectedImagePreviewControllerTimelineImage(options: Readonly<{
	readonly controller: object;
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
	readonly cloneProject?: (profile: unknown, project: unknown) => never;
}>): void {
	if (!options?.controller || typeof options.controller !== 'object') {
		throw new TypeError('Selected timelineImage image preview requires a controller owner.');
	}
	const previous = productVideoVisualPreviewRuntimeFor(options.controller);
	const inherited = previous && inheritedRuntimes.has(previous) ? inheritedRuntimes.get(previous) : previous;
	const runtime = createProductVideoVisualPreviewRuntime(
		async (request) => {
			if (isOpaquePreviewProject(request.project)) return null;
			const module = await import('./editor-selected-timeline-image-image-preview.ts');
			return module.createFramescaperSelectedVisualPreviewSessionTimelineImage({
				...request, profile: options.profile, store: options.store,
				...(inherited ? { createInheritedSession: inherited.create.bind(inherited) } : {}),
				...(options.cloneProject ? { cloneProject: options.cloneProject } : {}),
			});
		},
		async (request) => {
			if (isOpaquePreviewProject(request.project)) return null;
			const module = await import('./editor-selected-timeline-image-image-preview.ts');
			return module.createFramescaperSelectedProjectBinThumbnailTimelineImage({
				...request, profile: options.profile, store: options.store,
				...(inherited?.createProjectBinThumbnail
					? { createInheritedThumbnail: inherited.createProjectBinThumbnail.bind(inherited) } : {}),
				...(options.cloneProject ? { cloneProject: options.cloneProject } : {}),
			});
		},
		async (request) => {
			if (isOpaquePreviewProject(request.project)) return null;
			const module = await import('./editor-selected-timeline-image-image-filmstrip.ts');
			return module.createFramescaperSelectedTimelineFilmstripTimelineImage({
				...request, profile: options.profile, store: options.store,
				...(inherited?.createTimelineFilmstrip
					? { createInheritedFilmstrip: inherited.createTimelineFilmstrip.bind(inherited) } : {}),
				...(options.cloneProject ? { cloneProject: options.cloneProject } : {}),
			});
		},
	);
	inheritedRuntimes.set(runtime, inherited ?? null);
	bindProductVideoVisualPreviewRuntime(options.controller, runtime);
}

/** Opaque custody has no owning visual runtime; malformed inputs retain factory validation. */
function isOpaquePreviewProject(project: unknown): boolean {
	try {
		return classifyProjectSchemaIdentity(project, FRAMESCAPER_PROJECT_SCHEMA_FAMILY).disposition !== 'current';
	} catch {
		return false;
	}
}
