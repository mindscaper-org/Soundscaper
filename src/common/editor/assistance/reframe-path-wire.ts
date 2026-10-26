/* SPDX-License-Identifier: AGPL-3.0-only */

/** Lossless terminal wire: sampled authority once, exact crop tuples, shared provenance sets. */
import { reviewAssistanceOwnedReframePathV1 } from './owned-video-highlight-transform-results-v1.ts';
import { ownedArray, ownedExactRecord, ownedInteger } from './owned-transform-validation-v1.ts';
import { ASSISTANCE_GUIDED_TERMINAL_JSON_MAXIMUM_BYTES } from './guided-terminal-output-capacity.ts';

const AUTHORITIES = ['subject', 'saliency', 'center'] as const;
const MAXIMUM_FRAMES = 100_000;
const MAXIMUM_EXPANDED_BYTES = 64 * 1024 * 1024;
const FIELDS = ['wireVersion', 'kind', 'width', 'height', 'timescale', 'targetAspect', 'trackSets', 'frames'] as const;

export function packAssistanceReframePathV1(value: unknown) {
	const result = reviewAssistanceOwnedReframePathV1(value);
	const trackSets: (readonly string[])[] = [];
	const indices = new Map<string, number>();
	let expandedBytes = 0;
	const frames = result.path.keyframes.map((keyframe, index) => {
		const key = JSON.stringify(keyframe.trackIds);
		expandedBytes += 256 + new TextEncoder().encode(key).byteLength;
		if (expandedBytes > MAXIMUM_EXPANDED_BYTES) throw new RangeError('Packed Reframe expansion exceeds its deterministic semantic capacity.');
		let trackSet = indices.get(key);
		if (trackSet === undefined) { trackSet = trackSets.length; indices.set(key, trackSet); trackSets.push(keyframe.trackIds); }
		const { sourceFrame, presentationTick } = result.authority.frames[index]!;
		const { left, right, top, bottom } = keyframe.crop;
		return [sourceFrame, presentationTick, AUTHORITIES.indexOf(keyframe.authority), trackSet, left, right, top, bottom];
	});
	return { wireVersion: 1, kind: 'packed-reframe-path', width: result.authority.width,
		height: result.authority.height, timescale: result.authority.timescale,
		targetAspect: result.path.targetAspect, trackSets, frames };
}

export function encodeAssistanceReframePathWireV1(value: unknown): Uint8Array<ArrayBuffer> {
	const result = reviewAssistanceOwnedReframePathV1(value);
	const plain = new TextEncoder().encode(JSON.stringify(result));
	if (plain.byteLength <= ASSISTANCE_GUIDED_TERMINAL_JSON_MAXIMUM_BYTES) return plain;
	const packed = new TextEncoder().encode(JSON.stringify(packAssistanceReframePathV1(result)));
	if (packed.byteLength > ASSISTANCE_GUIDED_TERMINAL_JSON_MAXIMUM_BYTES) throw new RangeError('The complete Reframe result exceeds its terminal wire capacity.');
	return packed;
}

/** Legacy JSON remains valid. Packed JSON is expanded only inside the same bounded terminal review. */
export function decodeAssistanceReframePathWireV1(value: unknown): unknown {
	if (!value || typeof value !== 'object' || (value as Record<string, unknown>).kind !== 'packed-reframe-path') return value;
	const wire = ownedExactRecord(value, FIELDS, 'packed Reframe path');
	if (wire.wireVersion !== 1) throw new TypeError('Packed Reframe wire version is unsupported.');
	const trackSets = ownedArray(wire.trackSets, MAXIMUM_FRAMES, 'Reframe track sets', 1).map(set =>
		ownedArray(set, 256, 'Reframe provenance tracks').map(track => {
			if (typeof track !== 'string' || track.length > 256) throw new TypeError('Packed Reframe track IDs must be bounded text.');
			return track;
		}));
	const setBytes = trackSets.map(set => new TextEncoder().encode(JSON.stringify(set)).byteLength);
	let expandedBytes = 0;
	const frames = ownedArray(wire.frames, MAXIMUM_FRAMES, 'packed Reframe frames', 1).map(frame => {
		const tuple = ownedArray(frame, 8, 'packed Reframe frame tuple', 8);
		const authority = AUTHORITIES[ownedInteger(tuple[2], 0, 2, 'packed crop authority')]!;
		const set = ownedInteger(tuple[3], 0, trackSets.length - 1, 'packed track set');
		expandedBytes += 256 + setBytes[set]!;
		if (expandedBytes > MAXIMUM_EXPANDED_BYTES) throw new RangeError('Packed Reframe expansion exceeds its deterministic semantic capacity.');
		return { sourceFrame: tuple[0], presentationTick: tuple[1], authority, trackIds: trackSets[set]!,
			crop: { left: tuple[4], right: tuple[5], top: tuple[6], bottom: tuple[7] } };
	});
	return reviewAssistanceOwnedReframePathV1({ schemaVersion: 1, kind: 'reframe-path',
		authority: { width: wire.width, height: wire.height, timescale: wire.timescale,
			frames: frames.map(({ sourceFrame, presentationTick }) => ({ sourceFrame, presentationTick })) },
		fallbackChain: ['subject', 'saliency', 'center'], path: { schemaVersion: 1,
			targetAspect: wire.targetAspect, keyframes: frames.map(({ sourceFrame, authority, trackIds, crop }) => ({ sourceFrame, authority, trackIds, crop })) } });
}
