/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef, useState } from 'react';
import { resolveSelectionRange } from '../../selection-range.ts';
import { expandTimelineMarkerGroups, selectTimelineMarker } from '../../timeline-marker-groups.ts';

import { usePresentationFeedback } from '../presentation-feedback.ts';
import { consumeTimelineAnnotationRenameKey } from './timeline-annotation-rename-keyboard.ts';
import {
	resolveTimelineAnnotationKeyboardIntent,
	timelineAnnotationConversionRequest,
	timelineAnnotationCreateKind,
	timelineAnnotationEditBounds,
	timelineAnnotationEditIds,
} from './timeline-annotation-ui-model.ts';
import { useTimelineAnnotationModels } from './useTimelineAnnotationModels.ts';
import { planTimelineAnnotationMove } from './timeline-annotation-move-preview.ts';

const EMPTY_SELECTION = Object.freeze([]);

export function useTimelineAnnotationInteractions({
	controller,
	project,
	annotations,
	selectedAnnotationId,
	copy,
	locale,
	sampleRate,
	blocked,
	run,
	createAnnotation,
	focusFallbackRef,
	deferKeyboardFocus = false,
	revealKeyboardFocus = false,
}) {
	const { model, projected } = useTimelineAnnotationModels({
		annotations,
		primarySequenceId: project.primarySequenceId,
		selectedAnnotationIds: project.selection?.annotationIds || [],
		focusedAnnotationId: selectedAnnotationId,
		sampleRate,
		locale,
		secondsUnit: copy.annotationSecondsUnit,
	});
	const actions = controller.actions.timelineAnnotations;
	const regionSelection = resolveSelectionRange(project) ?? project.selection;
	const itemRefs = useRef(new Map());
	const renameCompletionRef = useRef(null);
	const [editingId, setEditingId] = useState(null);
	const [draftName, setDraftName] = useState('');
	const [markerMenu, setMarkerMenu] = useState(null);
	const [status, setStatus] = usePresentationFeedback(copy);

	const focusCreated = (annotationId) => {
		const item = itemRefs.current.get(annotationId);
		item?.focus({ preventScroll: true });
		item?.scrollIntoView?.({ block: 'nearest' });
	};
	const select = (event, annotation) => {
		if (blocked) return EMPTY_SELECTION;
		const toggle = event.metaKey || event.ctrlKey;
		const ids = selectTimelineMarker(projected, model.selectedIds, annotation.id, toggle ? 'toggle' : event.shiftKey ? 'add' : 'replace');
		run(() => {
			const result = event.metaKey || event.ctrlKey
				? actions.toggle(annotation.id)
				: actions.select(annotation.id, event.shiftKey);
			setStatus(message(
				ids.includes(annotation.id) ? 'timelineAnnotationSelected' : 'timelineAnnotationDeselected',
				{ name: annotation.name || { key: 'unnamedTimelineAnnotation' } },
			));
			return result;
		});
		return ids;
	};
	const beginRename = (annotation) => {
		if (blocked) return;
		setEditingId(annotation.id);
		setDraftName(annotation.name);
	};
	const openMarkerMenu = (event, annotation, keyboard = false) => {
		event.preventDefault();
		event.stopPropagation();
		const target = event.currentTarget;
		const bounds = target.getBoundingClientRect();
		setMarkerMenu({ id: annotation.id, target, x: keyboard ? bounds.left : event.clientX,
			y: keyboard ? bounds.bottom : event.clientY });
	};
	const finishRename = (annotation, save, restoreFocus = false) => {
		if (!blocked && save && draftName !== annotation.name) {
			run(() => {
				const result = actions.rename([annotation.id], draftName);
				setStatus(message('timelineAnnotationRenamed', {
					name: draftName || { key: 'unnamedTimelineAnnotation' },
				}));
				return result;
			});
		}
		setEditingId(null);
		if (restoreFocus) requestAnimationFrame(() => (
			itemRefs.current.get(annotation.id) || focusFallbackRef.current
		)?.focus({ preventScroll: true }));
	};
	const handleRenameBlur = (annotation) => {
		const intent = renameCompletionRef.current;
		renameCompletionRef.current = null;
		if (editingId === annotation.id) {
			finishRename(annotation, intent?.save ?? true, intent?.restoreFocus === true);
		}
	};
	const handleRenameKeyDown = (event) => {
		const intent = consumeTimelineAnnotationRenameKey(event);
		if (!intent) return;
		renameCompletionRef.current = intent;
		event.currentTarget.blur();
	};
	const selectedEditIds = (annotationId) => expandTimelineMarkerGroups(projected, timelineAnnotationEditIds(annotationId, model.selectedIds));
	const remove = (annotation, rowIndex, single = false) => {
		if (blocked) return;
		const ids = single ? [annotation.id] : selectedEditIds(annotation.id);
		const index = rowIndex ?? model.rows.findIndex(({ id }) => id === annotation.id);
		const removed = new Set(ids);
		const targetId = model.rows.slice(index + 1).find(({ id }) => !removed.has(id))?.id
			|| [...model.rows.slice(0, index)].reverse().find(({ id }) => !removed.has(id))?.id
			|| null;
		run(() => {
			const result = actions.remove(ids);
			setStatus(message('timelineAnnotationRemoved', { count: ids.length }));
			requestAnimationFrame(() => (
				targetId ? itemRefs.current.get(targetId) : focusFallbackRef.current
			)?.focus({ preventScroll: true }));
			return result;
		});
	};
	const moveTo = (annotation, requestedFrame) => {
		const bounds = timelineAnnotationEditBounds(annotation.id, selectedEditIds(annotation.id), projected);
		return moveBy(annotation, bounds, integerFrame(requestedFrame) - annotation.timelineStartFrame);
	};
	const resizeTo = (annotation, edge, requestedFrame) => {
		if (blocked) return;
		run(() => {
			const frame = integerFrame(requestedFrame);
			const currentFrame = edge === 'start'
				? annotation.timelineStartFrame
				: annotation.timelineEndFrame;
			if (frame === currentFrame) return null;
			const result = actions.resize(annotation.id, edge, frame);
			setStatus(message('timelineAnnotationResized', {
				name: annotation.name || { key: 'unnamedTimelineAnnotation' }, frame,
			}));
			return result;
		});
	};
	const moveBy = (annotation, bounds, deltaFrames) => {
		if (blocked || !deltaFrames) return false;
		return run(() => {
			const ids = new Set(bounds.ids);
			const move = planTimelineAnnotationMove(project, projected.filter(value => ids.has(value.id)), annotation.id, deltaFrames);
			if (!move.deltaFrames) return false;
			const result = actions.move(bounds.ids, move.deltaFrames, annotation.id);
			setStatus(message('timelineAnnotationMoved', {
				name: annotation.name || { key: 'unnamedTimelineAnnotation' }, frames: move.deltaFrames,
			}));
			return result;
		});
	};
	const convert = (annotation, changes) => {
		if (blocked) return;
		run(() => actions.convert(
			annotation.id,
			timelineAnnotationConversionRequest(annotation, changes, sampleRate),
		));
	};
	const focusKeyboardTarget = (annotationId) => {
		const focus = () => {
			const item = itemRefs.current.get(annotationId);
			item?.focus({ preventScroll: true });
			if (revealKeyboardFocus) item?.scrollIntoView?.({ block: 'nearest' });
		};
		if (deferKeyboardFocus) requestAnimationFrame(focus);
		else focus();
	};
	const handleKeyDown = (event, row, index) => {
		const annotation = row.annotation;
		const createKind = timelineAnnotationCreateKind(event, regionSelection);
		if (createKind) {
			event.preventDefault();
			event.stopPropagation();
			if (!blocked) createAnnotation(createKind, focusCreated);
			return;
		}
		const bounds = timelineAnnotationEditBounds(annotation.id, selectedEditIds(annotation.id), projected);
		const intent = resolveTimelineAnnotationKeyboardIntent(annotation, event, sampleRate, bounds);
		if (!intent) return;
		event.preventDefault();
		event.stopPropagation();
		if (intent.type === 'focus') {
			const target = model.rows[index + intent.offset];
			if (!target) return;
			run(() => actions.focus(target.id));
			focusKeyboardTarget(target.id);
		} else if (blocked) {
			return;
		} else if (intent.type === 'rename') beginRename(annotation);
		else if (intent.type === 'remove') remove(annotation, index);
		else if (intent.type === 'toggle') {
			run(() => {
				const result = actions.toggle(annotation.id);
				setStatus(message(
					row.selected ? 'timelineAnnotationDeselected' : 'timelineAnnotationSelected',
					{ name: annotation.name || { key: 'unnamedTimelineAnnotation' } },
				));
				return result;
			});
		} else if (intent.type === 'resize') resizeTo(annotation, intent.edge, intent.frame);
		else moveBy(annotation, bounds, (event.key === 'ArrowLeft' ? -1 : 1) * (event.ctrlKey || event.metaKey ? sampleRate : 1));
	};

	return {
		actions,
		beginRename,
		convert,
		draftName,
		editingId,
		focusCreated,
		handleKeyDown,
		handleRenameBlur,
		handleRenameKeyDown,
		itemRefs,
		markerMenu,
		openMarkerMenu,
		closeMarkerMenu: () => setMarkerMenu(null),
		model,
		moveBy,
		moveTo,
		projected,
		remove,
		resizeTo,
		select,
		selectedEditIds,
		setDraftName,
		setStatus,
		status,
	};
}

function integerFrame(value) {
	const frame = Number(value);
	if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('Annotation frame must be a non-negative safe integer.');
	return frame;
}

function message(key, parameters) { return { key, parameters }; }
