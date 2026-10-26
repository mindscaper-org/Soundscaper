/* SPDX-License-Identifier: AGPL-3.0-only */

import { createTimelineViewportClipIndex, type TimelineViewportClipIndex } from '../../design-system-adapters/timeline-viewport-index.ts';
import { createAudioTrackVisualRevisionReader } from './audio-track-visual-revision.ts';
import type { TimelineClipVisualController, TimelineWaveformClip } from './waveform-view-model.ts';

interface DragPreview { readonly trackId?: string; readonly clipId?: string; readonly clip?: Readonly<{ id?: string; projectBinClipId?: string; kind?: string }>; readonly previews?: readonly DragPreview[]; }
type CanonicalRowClip = Pick<TimelineWaveformClip, 'id' | 'timelineStartFrame' | 'durationFrames'> & Partial<TimelineWaveformClip>;
export interface AudioTrackRowMemoProps extends Readonly<Record<string, unknown>> {
	readonly controller: TimelineClipVisualController;
	readonly track: Readonly<{ id: string; type: string }>;
	readonly trackClips: readonly CanonicalRowClip[];
	readonly clipLookup: ReadonlyMap<string, CanonicalRowClip>;
	readonly renderViewportStartFrame: number;
	readonly viewportDurationFrames: number;
	readonly selectedTrackId?: string | null;
	readonly selectedClipId?: string | null;
	readonly selectedClipIdSet: ReadonlySet<string>;
	readonly draggingClipIds?: ReadonlySet<string> | null;
	readonly clipDragPreview?: DragPreview | null;
	readonly projectBinDragPreview?: DragPreview | null;
	readonly viewModelRevision?: Readonly<{ preferences?: Readonly<{ waveformVisualization?: unknown }> }>;
	readonly automationTargets?: readonly unknown[];
}

const EMPTY_IDS: ReadonlySet<string> = new Set();
const EMPTY_TARGETS: readonly unknown[] = Object.freeze([]);
const entries = (preview: DragPreview | null | undefined) => preview?.previews ?? (preview ? [preview] : []);

function retainIntersection(previous: ReadonlySet<string>, source: ReadonlySet<string>, belongs: (id: string) => boolean): ReadonlySet<string> {
	let count = 0, changed = false;
	for (const id of source) if (belongs(id)) { count++; if (!previous.has(id)) changed = true; }
	if (!changed && previous.size === count) return previous;
	if (!count) return EMPTY_IDS;
	const next = new Set<string>();
	for (const id of source) if (belongs(id)) next.add(id);
	return next;
}

/** Narrow global selection/media notifications before the expensive row reconciles. */
export function createAudioTrackRowPropReader() {
	let committed: AudioTrackRowMemoProps | null = null;
	let clips: readonly CanonicalRowClip[] | null = null;
	let clipIds: ReadonlySet<string> = EMPTY_IDS;
	let viewportIndex: TimelineViewportClipIndex<CanonicalRowClip> | null = null;
	// One result belongs to the current immutable track snapshot and frame range.
	let visibleClips: readonly CanonicalRowClip[] | null = null;
	let visibleStart = NaN, visibleEnd = NaN;
	let selectedIds: ReadonlySet<string> = EMPTY_IDS;
	let draggedIds: ReadonlySet<string> = EMPTY_IDS;
	let visualRevision: readonly unknown[] | null = null;
	let frequencyPreferences: unknown;
	let revision: unknown;
	const callbacks = new Map<string, (...args: unknown[]) => unknown>();
	const readVisual = createAudioTrackVisualRevisionReader();
	return {
		publish(props: AudioTrackRowMemoProps) { committed = props; },
		read(props: AudioTrackRowMemoProps): Readonly<Record<string, unknown>> {
			if (clips !== props.trackClips) {
				clips = props.trackClips;
				clipIds = new Set(clips.map(clip => clip.id));
				viewportIndex = clips.length > 128 ? createTimelineViewportClipIndex(clips) : null;
				visibleClips = null;
			}
			const previewEntries = entries(props.clipDragPreview);
			const clipDragPreview = previewEntries.some(preview => preview.trackId === props.track.id || (preview.clipId && clipIds.has(preview.clipId)))
				? props.clipDragPreview : null;
			const projectBinDragPreview = entries(props.projectBinDragPreview).some(preview => preview.trackId === props.track.id && preview.clip?.kind === props.track.type)
				? props.projectBinDragPreview : null;
			const incoming = clipDragPreview ? new Set(previewEntries.filter(preview => preview.trackId === props.track.id).flatMap(preview => preview.clipId ? [preview.clipId] : [])) : EMPTY_IDS;
			const binVisualClips = entries(projectBinDragPreview).flatMap(preview => preview.clip?.id ? [{ id: preview.clip.id, projectBinClipId: preview.clip.projectBinClipId }] : []);
			const belongs = (id: string) => clipIds.has(id) || incoming.has(id);
			selectedIds = retainIntersection(selectedIds, props.selectedClipIdSet, belongs);
			draggedIds = retainIntersection(draggedIds, props.draggingClipIds ?? EMPTY_IDS, belongs);
			const start = Math.max(0, props.renderViewportStartFrame - props.viewportDurationFrames);
			const end = Math.min(Number.MAX_SAFE_INTEGER, props.renderViewportStartFrame + props.viewportDurationFrames * 2);
			if (!visibleClips || visibleStart !== start || visibleEnd !== end) {
				visibleClips = viewportIndex?.query(start, end) ?? props.trackClips;
				visibleStart = start; visibleEnd = end;
			}
			const visible = visibleClips;
			const visualClips = incoming.size || binVisualClips.length
				? [...visible, ...[...incoming].flatMap(id => props.clipLookup.get(id) ?? []), ...binVisualClips] : visible;
			const nextVisualRevision = readVisual(props.controller, visualClips);
			const nextPreferences = props.viewModelRevision?.preferences?.waveformVisualization;
			if (visualRevision !== nextVisualRevision || frequencyPreferences !== nextPreferences) {
				visualRevision = nextVisualRevision; frequencyPreferences = nextPreferences;
				revision = { preferences: { waveformVisualization: nextPreferences }, visualRevision };
			}
			const narrowed: Record<string, unknown> = { ...props,
				selectedTrackId: props.selectedTrackId === props.track.id ? props.track.id : null,
				selectedClipId: props.selectedClipId && belongs(props.selectedClipId) ? props.selectedClipId : null,
				selectedClipIdSet: selectedIds, draggingClipIds: draggedIds.size ? draggedIds : null,
				clipDragPreview, projectBinDragPreview, viewModelRevision: revision,
				spectralSelection: props.selectedTrackId === props.track.id ? props.spectralSelection : null,
				automationTargets: props.automationTargets?.length ? props.automationTargets : EMPTY_TARGETS,
			};
			for (const [key, value] of Object.entries(props)) {
				if (typeof value !== 'function') continue;
				let callback = callbacks.get(key);
				if (!callback) {
					callback = (...args) => {
						const current = committed?.[key];
						return typeof current === 'function' ? (current as (...values: unknown[]) => unknown)(...args) : undefined;
					};
					callbacks.set(key, callback);
				}
				narrowed[key] = callback;
			}
			return narrowed;
		},
	};
}
