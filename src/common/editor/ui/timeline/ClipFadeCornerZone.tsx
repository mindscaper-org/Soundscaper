/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MouseEvent } from 'react';

interface Props {
	readonly edge: 'in' | 'out';
	readonly x: number;
	readonly clipWidth: number;
	readonly hasFade: boolean;
	readonly disabled: boolean;
	readonly onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
}

/** The corner retains pointer admission while its noninteractive fade glyph appears on hover. */
export function ClipFadeCornerZone({ edge, x, clipWidth, hasFade, disabled, onContextMenu }: Props) {
	return <div className={`audio-editor-clip-fade__zone audio-editor-clip-fade__zone--${edge}`}
		data-fade-zone={edge} data-clip-fade-handle={edge} data-has-fade={hasFade || undefined}
		data-disabled={disabled || undefined} tabIndex={-1} aria-hidden="true"
		style={{ left: x - 16, clipPath: `inset(0 ${Math.max(0, x + 16 - clipWidth + 6)}px 0 ${Math.max(0, 22 - x)}px)` }} onContextMenu={onContextMenu}
		onMouseDown={event => { event.preventDefault(); event.stopPropagation(); }} onClick={event => event.stopPropagation()}
		onDoubleClick={event => event.stopPropagation()} />;
}
