/* SPDX-License-Identifier: AGPL-3.0-only */

/** Framescaper caption burn-in planning for an exact selection. */

import { resolveVideoBurnInStage, type VideoBurnInStage } from '../common/editor/video-caption-burn-in.ts';
import {
	normalizeVideoCaptionTrackV1,
	type VideoCaptionCueV1,
	type VideoCaptionTrackV1,
	type VideoCaptionWordV1,
} from '../common/editor/video-caption-track-v27.ts';

export type FramescaperCaptionSidecarFormat = 'srt' | 'vtt' | 'imsc1';

export interface FramescaperCaptionDeliveryRequest {
	readonly trackId: string;
	readonly mux: boolean;
	readonly burnIn: boolean;
	readonly sidecar: FramescaperCaptionSidecarFormat | null;
}

interface FramescaperCaptionDeliveryContext {
	readonly range: Readonly<{ readonly startFrame: number; readonly endFrame: number }>;
	readonly canvas: Readonly<{ readonly width: number; readonly height: number }>;
}

export function resolveFramescaperCaptionBurnInStage(
	track: VideoCaptionTrackV1,
	range: FramescaperCaptionDeliveryContext['range'],
	canvas: FramescaperCaptionDeliveryContext['canvas'],
	sampleRate: number,
): VideoBurnInStage {
	const stage = burnInTrack(deliveredTrack(track, range), canvas, sampleRate);
	if (!stage) throw new RangeError('The selected Framescaper caption track has no drawable cues in the delivered range.');
	return stage;
}

function burnInTrack(track: VideoCaptionTrackV1, canvas: FramescaperCaptionDeliveryContext['canvas'],
	sampleRate: number): VideoBurnInStage | null {
	return resolveVideoBurnInStage(track.cues.map(({ startFrame, endFrame, text }) => ({
		startFrame, endFrame, title: text,
	})), canvas, sampleRate);
}

function deliveredTrack(
	track: VideoCaptionTrackV1,
	range: FramescaperCaptionDeliveryContext['range'],
): VideoCaptionTrackV1 {
	return normalizeVideoCaptionTrackV1({
		...track,
		cues: track.cues.flatMap((cue) => {
			const startFrame = Math.max(cue.startFrame, range.startFrame);
			const endFrame = Math.min(cue.endFrame, range.endFrame);
			if (endFrame <= startFrame) return [];
			return [{
				...cue,
				startFrame: startFrame - range.startFrame,
				endFrame: endFrame - range.startFrame,
				words: deliveredWords(cue, range),
			}];
		}),
	});
}

function deliveredWords(
	cue: VideoCaptionCueV1,
	range: FramescaperCaptionDeliveryContext['range'],
): readonly VideoCaptionWordV1[] {
	return cue.words.flatMap((word) => {
		const startFrame = Math.max(word.startFrame, range.startFrame);
		const endFrame = Math.min(word.endFrame, range.endFrame);
		return endFrame <= startFrame ? [] : [Object.freeze({
			startFrame: startFrame - range.startFrame,
			endFrame: endFrame - range.startFrame,
			text: word.text,
		})];
	});
}

export function snapshotFramescaperCaptionDeliveryRequest(
	value: unknown,
): FramescaperCaptionDeliveryRequest {
	const row = closedRecord(value, ['trackId', 'mux', 'burnIn', 'sidecar'], 'Framescaper caption delivery request');
	if (typeof row.trackId !== 'string' || row.trackId.length === 0) {
		throw new TypeError('Framescaper caption delivery request.trackId must be a non-empty string.');
	}
	if (typeof row.mux !== 'boolean' || typeof row.burnIn !== 'boolean') {
		throw new TypeError('Framescaper caption delivery request mux and burnIn must be booleans.');
	}
	if (row.sidecar !== null && row.sidecar !== 'srt'
		&& row.sidecar !== 'vtt' && row.sidecar !== 'imsc1') {
		throw new RangeError('Framescaper caption sidecar format is unsupported.');
	}
	return Object.freeze({
		trackId: row.trackId,
		mux: row.mux,
		burnIn: row.burnIn,
		sidecar: row.sidecar,
	}) as FramescaperCaptionDeliveryRequest;
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	name: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed plain record.`);
	}
	const row = value as Readonly<Record<string, unknown>>;
	const keys = Reflect.ownKeys(row);
	if (keys.length !== fields.length || keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(row, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${field} must be an own enumerable data property.`);
		}
	}
	return row;
}
