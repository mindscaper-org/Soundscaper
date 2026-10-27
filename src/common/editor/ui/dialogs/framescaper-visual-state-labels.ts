/* SPDX-License-Identifier: AGPL-3.0-only */
import { FRAMESCAPER_VISUAL_INSPECTOR_ADDITIONAL_COPY as VISUAL } from '../../../i18n/editor-framescaper-visual-inspector-additional-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';
import type { FramescaperVisualInspectorModel } from '../framescaper-visual-inspector-model.ts';
import type { VideoVisualPresentationV1 } from '../../video-visual-presentation-v27.ts';
type Copy = Readonly<Record<string, string | undefined>>;
const VISUAL_KINDS = { still: 'visualKindStill', title: 'visualKindTitle', text: 'text', shape: 'visualKindShape',
	solid: 'visualKindSolid', 'test-image': 'testImage', noise: 'noise', 'sound-visualizer': 'soundVisualizer' } as const;
const BLENDS = { normal: 'blendNormal', multiply: 'blendMultiply', screen: 'blendScreen', overlay: 'blendOverlay', add: 'blendAdd' } as const;

export function visualKindLabel(kind: FramescaperVisualInspectorModel['kind'], copy: Copy): string {
	return kind === null ? '' : resolveEditorCopyScope('framescaperVisualInspector', VISUAL, copy)[VISUAL_KINDS[kind]];
}
export function visualBlendLabel(mode: VideoVisualPresentationV1['blendMode'], copy: Copy): string {
	return resolveEditorCopyScope('framescaperVisualInspector', VISUAL, copy)[BLENDS[mode]];
}
