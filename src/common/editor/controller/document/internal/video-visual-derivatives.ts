/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoDerivativeInput } from '../../../storage/video-derivative-repository.ts';
import type { ObjectUrlPort, ProjectVisualSource, VideoDerivative, VideoVisualRecord } from '../project-visual-types.ts';
import { videoVisualMediaIdentity } from './video-visual-media-sync.ts';

/** Append live preview pixels without reloading the original or existing derivatives. */
export function createVideoVisualDerivativePublisher(
	getSources: () => readonly ProjectVisualSource[],
	records: Map<string, Readonly<VideoVisualRecord>>,
	knownMedia: ReadonlyMap<string, string>,
	url: ObjectUrlPort,
): (source: ProjectVisualSource, derivative: VideoDerivativeInput) => boolean {
	return (source, derivative) => {
		const current = getSources().find(candidate => candidate.id === source.id);
		const record = records.get(source.id);
		if (!current || !record || videoVisualMediaIdentity(current) !== videoVisualMediaIdentity(source)
			|| knownMedia.get(source.id) !== videoVisualMediaIdentity(source)) return false;
		if (!(derivative.blob instanceof Blob) || !['poster', 'thumbnail'].includes(derivative.type ?? '')) return false;
		const timestamp = derivative.timestamp ?? 0;
		if (!Number.isFinite(timestamp) || timestamp < 0) return false;
		const objectUrl = url.createObjectURL(derivative.blob);
		if (!objectUrl) return false;
		const { visual } = record;
		const replaced = derivative.type === 'poster' ? visual.posterUrl
			: visual.thumbnails.find(frame => frame.timestampSeconds === timestamp)?.url;
		const thumbnails = derivative.type === 'poster' ? visual.thumbnails : Object.freeze([
			...visual.thumbnails.filter(frame => frame.timestampSeconds !== timestamp),
			Object.freeze({ sourceTimeSeconds: timestamp, timestampSeconds: timestamp, url: objectUrl,
				...(typeof derivative.metadata?.width === 'number' ? { width: derivative.metadata.width } : {}),
				...(typeof derivative.metadata?.height === 'number' ? { height: derivative.metadata.height } : {}),
			}),
		].sort((left, right) => left.timestampSeconds - right.timestampSeconds));
		const posterUrl = derivative.type === 'poster' || visual.posterUrl === replaced ? objectUrl
			: visual.posterUrl ?? objectUrl;
		// A poster may borrow a thumbnail URL until a real poster arrives.
		const keepReplaced = replaced && thumbnails.some(frame => frame.url === replaced);
		records.set(source.id, Object.freeze({
			...record, visual: Object.freeze({ ...visual, posterUrl, thumbnails }),
			objectUrls: Object.freeze([...record.objectUrls.filter(value => !replaced || keepReplaced || value !== replaced), objectUrl]),
		}));
		if (replaced && !keepReplaced) url.revokeObjectURL(replaced);
		return true;
	};
}

export function readVideoDerivative(value: unknown): VideoDerivative {
	if (typeof value !== 'object' || value === null || Array.isArray(value)
		|| !('type' in value) || typeof value.type !== 'string') {
		throw new TypeError('Stored video derivative metadata is invalid.');
	}
	const optionalNumber = (key: 'timestamp' | 'width' | 'height'): number | undefined => {
		if (!(key in value)) return undefined;
		const field: unknown = Reflect.get(value, key);
		if (field === undefined) return undefined;
		if (typeof field !== 'number' || !Number.isFinite(field)) {
			throw new TypeError(`Stored video derivative ${key} is invalid.`);
		}
		return field;
	};
	return { ...value, type: value.type, timestamp: optionalNumber('timestamp'),
		width: optionalNumber('width'), height: optionalNumber('height') };
}
