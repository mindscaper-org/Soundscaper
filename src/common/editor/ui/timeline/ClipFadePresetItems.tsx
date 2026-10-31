/* SPDX-License-Identifier: AGPL-3.0-only */
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { END_FADE_SHAPE_PRESETS, selectedEndFadeShapePreset } from '../../clip-fade-presets.ts';
import { fadeOverlayGeometry, type ClipFadeEdge } from './clip-fade-geometry.ts';
import type { FadeShapeMenuCopy } from './FadeShapeMenu.tsx';

const LABEL_KEYS = {
	linear: 'fadeShapeLinear', logarithmic: 'fadeShapeLogarithmic', exponential: 'fadeShapeExponential',
	's-curve': 'fadeShapeSCurve', 'constant-power': 'fadeShapeConstantPower',
} as const;
const FALLBACKS = { linear: 'Linear', logarithmic: 'Logarithmic', exponential: 'Exponential', 's-curve': 'S-curve', 'constant-power': 'Constant power' };

/** Curve drawings use the same frame-based envelope as playback and the timeline. */
export function ClipFadePresetItems({ edge, hasFade, shape, copy, onSelect }: Readonly<{
	edge: ClipFadeEdge; hasFade: boolean; shape: number | undefined; copy: FadeShapeMenuCopy;
	onSelect: (shape: number | undefined) => void;
}>) {
	const selectedId = hasFade ? selectedEndFadeShapePreset(shape) : null;
	return <>{END_FADE_SHAPE_PRESETS.map((preset, index) => {
		const curve = fadeOverlayGeometry({ timelineStartFrame: 0, durationFrames: 16,
			[edge === 'in' ? 'fadeInFrames' : 'fadeOutFrames']: 16,
			[edge === 'in' ? 'fadeInShape' : 'fadeOutShape']: preset.shape }, 0, 16, 1, 1).curves[0]!;
		return <ContextMenuItem key={preset.id} role="menuitemradio" checked={selectedId === preset.id}
			label={copy[LABEL_KEYS[preset.id]] || FALLBACKS[preset.id]} shortcut={String(index + 1)}
			icon={<svg width="16" height="16" viewBox="0 0 16 100" preserveAspectRatio="none" aria-hidden="true">
				<path d={curve.path} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
			</svg>} onClick={() => onSelect(preset.shape)} />;
	})}<ContextMenuItem isDivider /></>;
}
