/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPortal } from 'react-dom';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { clipInteractionCopy } from '../../../i18n/editor-clip-interactions-copy.ts';
import type { FadeShapeMenuPosition } from './FadeShapeMenu.tsx';
import type { ClipFadeEdge } from './clip-fade-geometry.ts';
import { ClipFadePresetItems } from './ClipFadePresetItems.tsx';

interface Props {
	readonly position: FadeShapeMenuPosition;
	readonly edge: ClipFadeEdge;
	readonly hasFade: boolean;
	readonly shape: number | undefined;
	readonly onShape: (shape: number | undefined) => void;
	readonly copy: Readonly<Record<string, string>>;
	readonly onEdit: () => void;
	readonly onRemove: () => void;
	readonly onClose: () => void;
}

/** Upstream 27e16330: drawn curve presets precede fade editing and removal. */
export function ClipFadeMenu({ position, edge, hasFade, shape, copy, onShape, onEdit, onRemove, onClose }: Props) {
	const labels = clipInteractionCopy(copy);
	const host = position.target.closest('#kw-audio-editor-design-system') ?? position.target.ownerDocument.body;
	return createPortal(<div role="presentation" onPointerDown={event => event.stopPropagation()}
		onClick={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
		<ContextMenu isOpen x={position.x} y={position.y} autoFocus onClose={onClose} className="audio-editor-fade-shape-menu">
			<ClipFadePresetItems edge={edge} hasFade={hasFade} shape={shape} copy={copy} onSelect={value => {
				onClose(); onShape(value); if (position.target.isConnected) position.target.focus({ preventScroll: true });
			}} />
			<ContextMenuItem label={edge === 'in' ? labels.editFadeIn : labels.editFadeOut} onClick={() => { onClose(); onEdit(); }} />
			<ContextMenuItem label={edge === 'in' ? labels.removeFadeIn : labels.removeFadeOut} disabled={!hasFade}
				onClick={() => { onClose(); onRemove(); if (position.target.isConnected) position.target.focus({ preventScroll: true }); }} />
		</ContextMenu>
	</div>, host);
}
