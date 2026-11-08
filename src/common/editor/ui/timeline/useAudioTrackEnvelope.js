import { useEffect, useRef, useState } from 'react';

import { mergeDesignEnvelopePoints } from '../../automation.js';

/** @param {(event: Event) => void} complete */
export function retainEnvelopeCompletion(complete) {
	/** @param {MouseEvent} event */
	const release = (event) => { if (event.button === 0) complete(event); };
	/** @param {MouseEvent} event */
	const move = (event) => {
		if (typeof event.buttons === 'number' && (event.buttons & 1) === 0) complete(event);
	};
	document.addEventListener('mouseup', release);
	document.addEventListener('mousemove', move);
	window.addEventListener('blur', complete);
	return () => {
		document.removeEventListener('mouseup', release);
		document.removeEventListener('mousemove', move);
		window.removeEventListener('blur', complete);
	};
}

export function useAudioTrackEnvelope({
	controller,
	run,
	blocked,
	automationToolEnabled,
	clipLookup,
	projectionClips,
	sampleRate,
}) {
	const envelopePreviewRef = useRef(new Map());
	const [envelopePreviewRevision, setEnvelopePreviewRevision] = useState(0);
	const currentClipLookupRef = useRef(clipLookup);
	currentClipLookupRef.current = clipLookup;

	useEffect(() => {
		const previousSize = envelopePreviewRef.current.size;
		for (const [key, preview] of envelopePreviewRef.current) {
			const current = clipLookup.get(preview.clipId);
			if (!current || !sameEnvelopePoints(current.envelope, preview.expectedEnvelope)) envelopePreviewRef.current.delete(key);
		}
		if (previousSize !== envelopePreviewRef.current.size) setEnvelopePreviewRevision(revision => revision + 1);
	}, [clipLookup]);

	useEffect(() => {
		const pendingTasks = new Set();
		// Native events can run microtasks between document listeners. Wait for
		// the vendor's point publication before completing this gesture.
		const afterEvent = (operation) => {
			const task = setTimeout(() => { pendingTasks.delete(task); operation(); }, 0);
			pendingTasks.add(task);
		};
		const discardEnvelopeEdit = (event) => {
			if (event.key !== 'Escape') return;
			afterEvent(() => {
				if (!envelopePreviewRef.current.size) return;
				envelopePreviewRef.current.clear();
				setEnvelopePreviewRevision((revision) => revision + 1);
			});
		};
		const finishEnvelopeEdit = () => {
			afterEvent(() => {
				const previews = [...envelopePreviewRef.current.values()];
				if (!previews.length) return;
				envelopePreviewRef.current.clear();
				setEnvelopePreviewRevision((revision) => revision + 1);
				for (const preview of previews) {
					const current = currentClipLookupRef.current.get(preview.clipId);
					if (!current || !sameEnvelopePoints(current.envelope, preview.expectedEnvelope)) continue;
					run(() => controller.actions.clip.update(preview.clipId, { envelope: preview.envelope }));
				}
			});
		};
		const releaseCompletion = retainEnvelopeCompletion(event => {
			if (event.type !== 'mousemove' || envelopePreviewRef.current.size) finishEnvelopeEdit();
		});
		document.addEventListener('keydown', discardEnvelopeEdit);
		return () => {
			for (const task of pendingTasks) clearTimeout(task);
			releaseCompletion();
			document.removeEventListener('keydown', discardEnvelopeEdit);
		};
	}, [controller, run]);

	useEffect(() => {
		if (automationToolEnabled) return;
		envelopePreviewRef.current.clear();
		setEnvelopePreviewRevision((revision) => revision + 1);
	}, [automationToolEnabled]);

	const updateEnvelope = (clipId, designPoints) => {
		if (blocked || !automationToolEnabled) return;
		const canonical = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const projected = projectionClips.find((clip) => String(clip.id) === String(clipId));
		if (!canonical || !projected) return;
		const startFrame = projected.waveformStartFrame;
		const endFrame = projected.waveformEndFrame;
		envelopePreviewRef.current.set(String(canonical.id), {
			clipId: canonical.id,
			expectedEnvelope: envelopePreviewRef.current.get(String(canonical.id))?.expectedEnvelope ?? canonical.envelope,
			designPoints,
			envelope: mergeDesignEnvelopePoints(
				canonical.envelope,
				designPoints,
				sampleRate,
				canonical.durationFrames,
				{ startFrame, endFrame, maximumValue: 16 },
			),
		});
		setEnvelopePreviewRevision((revision) => revision + 1);
	};
	return { envelopePreviewRef, envelopePreviewRevision, updateEnvelope };
}

function sameEnvelopePoints(left, right) {
	return left === right || (left.length === right.length && left.every((point, index) => (
		point.frame === right[index].frame && point.value === right[index].value
	)));
}
