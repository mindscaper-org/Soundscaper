/* SPDX-License-Identifier: AGPL-3.0-only */

import { bindVideoSourceTimingView, type BoundVideoSourceTimingView, type VideoSourceTimingView } from '../common/editor/video-source-timing-view.ts';
import type { UnifiedExactRenderTimingSidecars } from '../common/editor/unified-exact-render-plan.ts';
import type { FramescaperProjectNativeMedia } from './editor-project-native-media.ts';

/** Bind only the plan's actual video sources to current, authenticated project timing views. */
export function framescaperNativePlanTimingAuthority(
	project: FramescaperProjectNativeMedia,
	views: ReadonlyMap<string, VideoSourceTimingView>,
	sourceIds: readonly string[],
): UnifiedExactRenderTimingSidecars {
	const sources = new Map((project.sources as readonly Readonly<Record<string, unknown>>[]).map(source => [String(source.id), source]));
	const result = new Map<string, BoundVideoSourceTimingView>();
	for (const sourceId of sourceIds) {
		const source = sources.get(sourceId);
		if (!source) throw new ReferenceError('A native plan source is outside its current project.');
		if (source.kind === 'video') result.set(sourceId, bindVideoSourceTimingView(views, source));
	}
	return result;
}
