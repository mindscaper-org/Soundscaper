/* SPDX-License-Identifier: AGPL-3.0-only */

import { createBoundarySnapIndex, resolveBoundarySnap, type BoundarySnapIndex } from './boundary-snap.ts';
import { timelineSelectionDragTrackIds } from './track-selection-scope.ts';
import { snapAudioEditorFrameWithProject } from '../../snap-grid.js';

type SelectionProject = Parameters<typeof createBoundarySnapIndex>[0]
	& Readonly<{ sampleRate?: number; snap?: unknown }>;

/** Physical magnets retain exact endpoints; ordinary selections use the enabled time grid. */
export function timelineSelectionDragRange(project: SelectionProject, start: number, end: number,
	boundarySnapped: boolean, maximumFrame?: number) {
	const place = (frame: number) => boundarySnapped ? frame
		: snapAudioEditorFrameWithProject(Math.round(frame), project, { maximumFrame });
	const startFrame = place(Math.min(start, end)), endFrame = place(Math.max(start, end));
	return { startFrame, endFrame };
}

interface SelectionDragSession {
	readonly lane: HTMLElement;
	readonly startFrame: number;
	readonly startSnapGuideFrame?: number | null;
	readonly snapDisabled?: boolean;
	snapIndex?: BoundarySnapIndex;
	lastRawEndFrame?: number;
	lastTrackIds?: string[];
	boundarySnapped?: boolean;
}

/** Share selection preview calculations while leaving initial click/seek semantics with its owner. */
export function previewTimelineSelectionDrag({
	session, project, rawEndFrame, clientY, scrollRoot, pixelsPerSecond, sampleRate, maximumFrame,
}: {
	readonly session: SelectionDragSession;
	readonly project: SelectionProject;
	readonly rawEndFrame: number;
	readonly clientY: number;
	readonly scrollRoot: HTMLElement | null;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly maximumFrame?: number;
}) {
	if (!session.snapDisabled && session.snapIndex?.project !== project) session.snapIndex = createBoundarySnapIndex(project);
	const endSnap = session.snapDisabled ? { frame: rawEndFrame, snapped: false } : resolveBoundarySnap({
		project, index: session.snapIndex, frame: rawEndFrame,
		currentTrackId: session.lane.dataset.trackId ?? null,
		pixelsPerSecond, sampleRate, rightEdge: rawEndFrame >= session.startFrame,
	});
	const trackIds = timelineSelectionDragTrackIds(session.lane, scrollRoot, clientY);
	session.lastRawEndFrame = rawEndFrame;
	session.lastTrackIds = trackIds;
	session.boundarySnapped = Number.isSafeInteger(session.startSnapGuideFrame) || endSnap.snapped;
	return {
		selection: {
			...timelineSelectionDragRange(project, session.startFrame, endSnap.frame,
				session.boundarySnapped, maximumFrame),
			trackIds,
		},
		guideFrames: [...new Set([
			session.startSnapGuideFrame, endSnap.snapped ? endSnap.frame : null,
		].filter((frame): frame is number => Number.isSafeInteger(frame)))],
	};
}
