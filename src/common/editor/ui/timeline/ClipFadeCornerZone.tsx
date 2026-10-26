/* SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { fadeOverlayGeometry, type ClipFadeEdge } from './clip-fade-geometry.ts';

interface Props {
	readonly edge: ClipFadeEdge;
	readonly x: number;
	readonly clipWidth: number;
	readonly hasFade: boolean;
	readonly disabled: boolean;
	readonly dragging: boolean;
	readonly onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
}

/** Upstream 2d007878: unselected clips fade through a 32px boundary zone. */
export function ClipFadeCornerZone({ edge, x, clipWidth, hasFade, disabled, dragging, onContextMenu }: Props) {
	const [peek, setPeek] = useState<'visible' | 'leaving' | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
	const curve = fadeOverlayGeometry({ timelineStartFrame: 0, durationFrames: 16,
		[edge === 'in' ? 'fadeInFrames' : 'fadeOutFrames']: 16,
		[edge === 'in' ? 'fadeInShape' : 'fadeOutShape']: 2 }, 0, 16, 1, 1).curves[0]!;
	return <><div className={`audio-editor-clip-fade__zone audio-editor-clip-fade__zone--${edge}`}
		data-fade-zone={edge} data-clip-fade-handle={edge} data-has-fade={hasFade || undefined}
		data-disabled={disabled || undefined} tabIndex={-1} aria-hidden="true"
		style={{ left: x - 16, clipPath: `inset(0 ${Math.max(0, x + 16 - clipWidth + 6)}px 0 ${Math.max(0, 22 - x)}px)` }} onContextMenu={onContextMenu}
		onMouseEnter={event => {
			if (timer.current !== null) clearTimeout(timer.current);
			if (!hasFade && !disabled && !dragging && event.buttons === 0) setPeek('visible');
		}}
		onMouseLeave={() => {
			setPeek(current => current ? 'leaving' : null);
			timer.current = setTimeout(() => { setPeek(null); timer.current = null; }, 60);
		}}
		onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
		onDoubleClick={event => event.stopPropagation()} />
		{peek && !hasFade && !dragging && <svg className="audio-editor-clip-fade__peek" data-fade-peek={edge}
			data-leaving={peek === 'leaving' || undefined} aria-hidden="true" viewBox="0 0 16 100"
			preserveAspectRatio="none" style={{ left: edge === 'in' ? x : x - 16 }}>
			<path d={curve.shadePath} fill="rgba(0, 0, 0, 0.2)" stroke="none" />
			<path d={curve.path} fill="none" stroke="rgba(0, 0, 0, 0.45)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
		</svg>}
	</>;
}
