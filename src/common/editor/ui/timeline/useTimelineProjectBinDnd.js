import { useCallback, useEffect } from 'react';

import {
	AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE,
	AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE,
	parseFreesoundResultDragPayload,
} from '../../project-bin-dnd.js';
import { isProductVisualClip } from '../../video-timeline-internals.js';
import { resolveSequenceTimingView } from '../../sequence-timing-model.ts';
import { sampleFrameToVideoFrame, videoFrameRangeToSampleRange } from '../../timeline-time.ts';
import { rebaseSequenceVisualFrame } from '../../timeline-visual-placement-time.ts';
import { compatibleMediaTrack } from './geometry.ts';
import { withWebFileLoadLimitContext } from '../../web-file-limit-failure.ts';
import { NEW_AUDIO_TRACK_DROP_TARGET } from './constants.ts';
import {
	dataTransferHasType,
	projectBinPayloadFromDataTransfer,
} from './interaction-helpers.js';

export function useTimelineProjectBinDnd({
	controller,
	confirmFileSizeWarning = /** @type {import('../../controller/shared/file-size-warning.ts').FileSizeWarningConfirmation | undefined} */ (undefined),
	mutationsBlocked,
	state,
	model,
	hitTesting,
	menuActions,
	importFreesoundSound = importFreesoundTimelineDrop,
}) {
	const { setDraggingClipIds, setProjectBinDragPreview } = state;
	const { project } = model;
	const { clearProjectBinDragState, timelineDropTargetAt } = hitTesting;
	const { run } = menuActions;

	const onTimelineDragOver = useCallback((event) => {
		const binDrag = dataTransferHasType(event.dataTransfer, AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE);
		const fileDrag = dataTransferHasType(event.dataTransfer, 'Files');
		const freesoundDrag = dataTransferHasType(event.dataTransfer, AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE);
		if (!binDrag && !fileDrag && !freesoundDrag) return;
		event.preventDefault();
		if (mutationsBlocked || !project) {
			event.dataTransfer.dropEffect = 'none';
			clearProjectBinDragState();
			return;
		}
		event.dataTransfer.dropEffect = 'copy';
		if (!binDrag) {
			setProjectBinDragPreview(null);
			setDraggingClipIds(null);
			return;
		}
		const payload = projectBinPayloadFromDataTransfer(event.dataTransfer);
		const clip = payload && String(payload.projectId) === String(project.id)
			? project.projectBin?.clips.find((item) => String(item.id) === String(payload.clipId))
			: null;
		if (!clip) {
			event.dataTransfer.dropEffect = 'none';
			clearProjectBinDragState();
			return;
		}
		const target = timelineDropTargetAt(event);
		const itemClips = clip.binItemId
			? project.projectBin.clips.filter((candidate) => candidate.binItemId === clip.binItemId)
			: [clip];
		const compatibleTracks = itemClips.map((itemClip) => (
			target.trackId ? compatibleMediaTrack(project, target.trackId, projectBinTrackKind(itemClip)) : null
		));
		if (itemClips.some((itemClip, index) => isProductVisualClip(itemClip) && lockedTrack(project, compatibleTracks[index]?.id))) {
			event.dataTransfer.dropEffect = 'none';
			clearProjectBinDragState();
			return;
		}
		const previewCreatesTrack = target.createTrack
			|| Boolean(target.trackId && compatibleTracks.some((candidate) => !candidate));
		const previews = itemClips.map((itemClip, index) => {
			const previewTrack = compatibleTracks[index];
			const range = isProductVisualClip(itemClip)
				? pictureDropRange(project, itemClip, previewTrack?.id ?? target.trackId, target.timelineStartFrame)
				: null;
			return {
				clip: range ? { ...itemClip, durationFrames: range.durationFrames } : itemClip,
				clipId: itemClip.id,
				trackId: previewCreatesTrack
					? `${NEW_AUDIO_TRACK_DROP_TARGET}-${index}`
					: previewTrack?.id || target.trackId,
				timelineStartFrame: range?.startFrame ?? target.timelineStartFrame,
			};
		});
		const activePreview = previews.find((preview) => preview.clipId === clip.id) || previews[0];
		const preview = {
			...activePreview,
			createTrack: previewCreatesTrack,
			previews,
		};
		setProjectBinDragPreview((current) => (
			current?.clipId === preview.clipId
			&& current.trackId === preview.trackId
			&& current.timelineStartFrame === preview.timelineStartFrame
			&& current.clip?.durationFrames === preview.clip?.durationFrames
			&& current.createTrack === preview.createTrack
				? current
				: preview
		));
		setDraggingClipIds((current) => (
			current?.size === previews.length
			&& previews.every((item) => current.has(String(item.clipId)))
				? current
				: new Set(previews.map((item) => String(item.clipId)))
		));
	}, [clearProjectBinDragState, mutationsBlocked, project, timelineDropTargetAt]);

	const onTimelineDragLeave = useCallback((event) => {
		const rect = event.currentTarget.getBoundingClientRect();
		if (
			event.clientX >= rect.left
			&& event.clientX < rect.right
			&& event.clientY >= rect.top
			&& event.clientY < rect.bottom
		) return;
		clearProjectBinDragState();
	}, [clearProjectBinDragState]);

	const onTimelineDrop = useCallback((event) => {
		const binDrag = dataTransferHasType(event.dataTransfer, AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE);
		const freesoundDrag = dataTransferHasType(event.dataTransfer, AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE);
		const files = [...(event.dataTransfer?.files || [])];
		if (!binDrag && !freesoundDrag && !files.length) return;
		event.preventDefault();
		const payload = binDrag ? projectBinPayloadFromDataTransfer(event.dataTransfer) : null;
		const freesoundSoundId = freesoundDrag ? parseFreesoundResultDragPayload(
			event.dataTransfer.getData(AUDIO_EDITOR_FREESOUND_RESULT_DRAG_TYPE),
		) : null;
		const target = timelineDropTargetAt(event);
		clearProjectBinDragState(true);
		if (mutationsBlocked || !project) return;
		if (payload) {
			if (String(payload.projectId) !== String(project.id)) return;
			const clip = project.projectBin?.clips.find((item) => String(item.id) === String(payload.clipId));
			if (!clip) return;
			const visual = isProductVisualClip(clip);
			const compatibleTrack = visual && target.trackId ? compatibleMediaTrack(project, target.trackId, 'video') : null;
			if (visual && lockedTrack(project, compatibleTrack?.id)) return;
			const trackId = compatibleTrack?.id ?? target.trackId;
			run(() => controller.actions.projectBin.place(clip.id, {
				...(trackId ? { trackId } : {}),
				...(visual && !compatibleTrack ? { createTrack: true } : {}),
				timelineStartFrame: target.timelineStartFrame,
			}));
			return;
		}
		if (freesoundSoundId !== null) {
			const targetTrack = target.trackId ? compatibleMediaTrack(project, target.trackId, 'audio') : null;
			run(() => importFreesoundSound(controller, {
				soundId: freesoundSoundId,
				destination: 'timeline',
				...(targetTrack ? { trackId: targetTrack.id } : {}),
				timelineStartFrame: target.timelineStartFrame,
			}, { confirmFileSizeWarning }));
			return;
		}
		if (files.length) {
			run(() => withWebFileLoadLimitContext(() => controller.actions.project.importFiles(files, {
				destination: 'timeline',
				...(target.trackId ? { trackId: target.trackId } : {}),
				timelineStartFrame: target.timelineStartFrame,
			})));
		}
	}, [clearProjectBinDragState, controller, confirmFileSizeWarning, importFreesoundSound, mutationsBlocked, project, run, timelineDropTargetAt]);

	useEffect(() => {
		const finishHtmlDrag = () => clearProjectBinDragState(true);
		globalThis.addEventListener('dragend', finishHtmlDrag, true);
		return () => globalThis.removeEventListener('dragend', finishHtmlDrag, true);
	}, [clearProjectBinDragState]);

	return { onTimelineDragOver, onTimelineDragLeave, onTimelineDrop };
}

function projectBinTrackKind(clip) {
	return isProductVisualClip(clip) ? 'video' : clip.kind;
}

function pictureDropRange(project, clip, trackId, sample) {
	const sequenceId = project.sequences.find(sequence => sequence.trackIds.includes(trackId))?.id;
	const { rate } = resolveSequenceTimingView(project, sequenceId);
	const origin = resolveSequenceTimingView(project, clip.sequenceId);
	const frame = sampleFrameToVideoFrame(sample, rate, project.sampleRate, 'point');
	const count = Math.max(1, rebaseSequenceVisualFrame(clip.sequenceFrameCount, origin.rate, rate));
	return videoFrameRangeToSampleRange(frame, count, rate, project.sampleRate);
}

function lockedTrack(project, trackId) {
	return trackId != null && project.tracks.some(track => track.id === trackId && track.locked === true);
}

export function importFreesoundTimelineDrop(controller, request, runtime = /** @type {import('../workspace/freesound-workspace-service.ts').FreesoundWorkspaceRuntime} */ ({})) {
	return import('../workspace/freesound-workspace-service.ts').then(({ importFreesoundSound }) => (
		importFreesoundSound(controller, request, runtime)
	));
}
