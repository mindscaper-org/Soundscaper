/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPortal } from 'react-dom';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { createLabeledAudioApplicationMenuItems, type LabeledAudioApplicationMenuCopy } from '../labeled-audio-application-menu.ts';
import type { RuntimeTimelineAnnotationProjection } from '../../runtime-timeline-annotation-projection.ts';

export type OpenMarkerRangeExport = (surface: 'export-selection', options: Readonly<{
	projectId: string; range: Readonly<{ startFrame: number; endFrame: number }>;
}>) => void;

export function createMarkerRangeExporter(openSurface: OpenMarkerRangeExport | undefined, projectId: string | undefined) {
	if (!openSurface || !projectId) return undefined;
	return (marker: RuntimeTimelineAnnotationProjection) => {
		if (marker.kind !== 'region') return;
		openSurface('export-selection', {
			projectId, range: { startFrame: marker.timelineStartFrame, endFrame: marker.timelineEndFrame },
		});
	};
}

interface Props {
	readonly position: Readonly<{ x: number; y: number; target: HTMLElement }>;
	readonly copy: LabeledAudioApplicationMenuCopy & Readonly<{ editMarker: string; deleteMarker: string; exportMarkerRange: string }>;
	readonly blocked: boolean;
	readonly range: boolean;
	readonly canEditAudio: boolean;
	readonly onEdit: () => void;
	readonly onDelete: () => void;
	readonly onExport?: () => void;
	readonly onAudioEdit: (action: string) => unknown;
	readonly onClose: () => void;
}

export function TimelineMarkerContextMenu({
	position, copy, blocked, range, canEditAudio, onEdit, onDelete, onExport, onAudioEdit, onClose,
}: Props) {
	const [audio] = range ? createLabeledAudioApplicationMenuItems({
		productId: canEditAudio ? 'soundscaper' : 'framescaper', copy, editBlocked: blocked, available: true,
	}, { executeEdit: onAudioEdit }) : [];
	const menu = <div role="presentation" onClick={event => event.stopPropagation()}
		onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}
		onKeyDown={event => event.stopPropagation()}>
		<ContextMenu isOpen x={position.x} y={position.y} onClose={onClose} className="audio-editor-label-context-menu">
			<ContextMenuItem label={copy.editMarker} tooltipKey="edit-marker" disabled={blocked} onClick={onEdit} onClose={onClose} />
			<ContextMenuItem label={copy.deleteMarker} tooltipKey="delete-marker" disabled={blocked} onClick={onDelete} onClose={onClose} />
			{range && onExport && <ContextMenuItem label={copy.exportMarkerRange} tooltipKey="export-marker-range" onClick={onExport} onClose={onClose} />}
			{audio && <ContextMenuItem label={audio.label} hasSubmenu disabled={blocked} onClose={onClose}>
				{audio.items.map(item => <ContextMenuItem key={item.id} label={item.label} tooltipKey={item.id}
					disabled={item.disabled} onClick={item.onClick} onClose={onClose} />)}
			</ContextMenuItem>}
		</ContextMenu>
	</div>;
	const portal = position.target.closest('#kw-audio-editor-design-system');
	return portal ? createPortal(menu, portal) : menu;
}
