/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';
import { folderContentSpans, folderContentTarget, type FolderContentProject, type FolderContentRange } from '../../folder-content-editing.ts';
import { timelineContentLeft } from './timeline-scroll-space.ts';
import { formatLocalizedTemplate } from '../localization-template.ts';

interface OverviewController {
	readonly actions: {
		readonly timeline: {
			snapFrame(frame: number): number;
			setExactSelection(start: number, end: number, details: Readonly<{ trackIds: readonly string[]; clipIds: readonly string[] }>): unknown;
		};
	};
}

interface OverviewProps {
	readonly project: FolderContentProject;
	readonly folderId: string;
	readonly name: string;
	readonly copy: Readonly<{ folderContentOverview: string }>;
	readonly selection?: (FolderContentRange & Readonly<{ trackIds?: readonly string[] }>) | null;
	readonly controller: OverviewController;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly renderOriginX: number;
	readonly run: (operation: () => unknown) => unknown;
}

/** Once Select folder contents opts into a subtree, its overview supports the same exact time range while collapsed. */
export function FolderContentOverview({ project, folderId, name, copy, selection, controller, pixelsPerSecond, sampleRate, renderOriginX, run }: OverviewProps) {
	const target = useMemo(() => folderContentTarget(project, folderId), [project, folderId]);
	const spans = useMemo(() => folderContentSpans(project, target.trackIds), [project, target]);
	const selected = target.trackIds.length > 0 && selection?.trackIds?.length === target.trackIds.length
		&& target.trackIds.every(id => selection.trackIds?.includes(id));
	const drag = useRef<{ pointerId: number; startFrame: number } | null>(null);
	const [preview, setPreview] = useState<FolderContentRange | null>(null);
	useEffect(() => { drag.current = null; setPreview(null); }, [project, folderId]);
	const frameAt = (event: PointerEvent<HTMLDivElement>): number => {
		const lane = event.currentTarget;
		const origin = Number.parseFloat(getComputedStyle(lane).getPropertyValue('--timeline-render-origin-x'));
		const raw = Math.max(0, Math.round((event.clientX - lane.getBoundingClientRect().left - CLIP_CONTENT_OFFSET
			- (Number.isFinite(origin) ? origin : renderOriginX)) / pixelsPerSecond * sampleRate));
		return controller.actions.timeline.snapFrame(raw);
	};
	const rangeAt = (event: PointerEvent<HTMLDivElement>, startFrame: number): FolderContentRange => {
		const endFrame = frameAt(event);
		return { startFrame: Math.min(startFrame, endFrame), endFrame: Math.max(startFrame, endFrame) };
	};
	const displayed = preview ?? (selected ? selection : null);
	return <div className="audio-editor-folder-content-overview" data-folder-overview={folderId}
		role={selected ? 'group' : undefined} aria-label={selected ? formatLocalizedTemplate(copy.folderContentOverview, { name }) : undefined}
		aria-hidden={selected ? undefined : true} tabIndex={selected ? -1 : undefined}
		onClick={event => event.stopPropagation()}
		onPointerDown={event => {
			if (!selected || event.button !== 0 || event.isPrimary === false) return;
			event.preventDefault(); event.stopPropagation();
			event.currentTarget.focus({ preventScroll: true });
			drag.current = { pointerId: event.pointerId, startFrame: frameAt(event) };
			setPreview({ startFrame: drag.current.startFrame, endFrame: drag.current.startFrame });
			event.currentTarget.setPointerCapture(event.pointerId);
		}}
		onPointerMove={event => {
			if (drag.current?.pointerId !== event.pointerId) return;
			event.stopPropagation(); setPreview(rangeAt(event, drag.current.startFrame));
		}}
		onPointerUp={event => {
			if (drag.current?.pointerId !== event.pointerId) return;
			event.preventDefault(); event.stopPropagation();
			const range = rangeAt(event, drag.current.startFrame);
			drag.current = null; setPreview(null);
			event.currentTarget.releasePointerCapture(event.pointerId);
			run(() => controller.actions.timeline.setExactSelection(range.startFrame, range.endFrame, { trackIds: target.trackIds, clipIds: [] }));
		}}
		onPointerCancel={() => { drag.current = null; setPreview(null); }}
		onLostPointerCapture={() => { drag.current = null; setPreview(null); }}>
		{spans.map(span => <span key={`${span.startFrame}:${span.endFrame}`} className="audio-editor-folder-content-span" aria-hidden="true"
			style={{ left: timelineContentLeft(CLIP_CONTENT_OFFSET + span.startFrame / sampleRate * pixelsPerSecond), width: Math.max(1, (span.endFrame - span.startFrame) / sampleRate * pixelsPerSecond) }} />)}
		{displayed && displayed.endFrame > displayed.startFrame && <span className="audio-editor-folder-content-selection" aria-hidden="true"
			style={{ left: timelineContentLeft(CLIP_CONTENT_OFFSET + displayed.startFrame / sampleRate * pixelsPerSecond), width: (displayed.endFrame - displayed.startFrame) / sampleRate * pixelsPerSecond }} />}
	</div>;
}
