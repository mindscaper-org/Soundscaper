/* SPDX-License-Identifier: AGPL-3.0-only */

import { trustedMediaContentSha256 } from '../common/editor/storage/media-content-provenance.ts';
import type { StorageRecord } from '../common/editor/storage/media-records.ts';
import type { FramescaperImageSourceV1 } from '../common/editor/timeline-image-model.ts';

export const FRAMESCAPER_TIMELINE_IMAGE_BODY_KIND_TIMELINE_IMAGE = 'timeline-image' as const;
export const FRAMESCAPER_TIMELINE_IMAGE_BODY_ENCODING_TIMELINE_IMAGE = 'framescaper-image-asset-v1' as const;

/** Check the exact staged image row inside its owning publication transaction. */
export function requireStagedTimelineImageBody(value: unknown, source: FramescaperImageSourceV1): StorageRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('timelineImage staged image body must be an object.');
	}
	const row = value as StorageRecord;
	const committedAt = canonicalTimestamp(row.committedAt, 'body committedAt');
	const pendingUntil = canonicalTimestamp(row.pendingProjectUntil, 'body pendingProjectUntil');
	if (Date.parse(pendingUntil) <= Date.parse(committedAt)
		|| row.sourceId !== source.storageKey
		|| row.kind !== FRAMESCAPER_TIMELINE_IMAGE_BODY_KIND_TIMELINE_IMAGE
		|| row.encoding !== FRAMESCAPER_TIMELINE_IMAGE_BODY_ENCODING_TIMELINE_IMAGE
		|| row.mimeType !== source.mimeType
		|| row.size !== source.assetByteLength
		|| trustedMediaContentSha256(row) !== source.contentSha256) {
		throw new Error('The staged timelineImage image body does not match its immutable source authority.');
	}
	return row;
}

export function canonicalTimestamp(value: unknown, name: string): string {
	if (typeof value !== 'string') throw new TypeError(`timelineImage image ${name} must be a timestamp.`);
	const date = new Date(value);
	if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
		throw new TypeError(`timelineImage image ${name} must be canonical.`);
	}
	return value;
}
