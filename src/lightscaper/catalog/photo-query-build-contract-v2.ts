/* SPDX-License-Identifier: AGPL-3.0-only */

import { LIGHTSCAPER_CATALOG_LIMITS } from './types.ts';
import { boolean, field, id, integer, record } from './value-validation.ts';

export interface PhotoQueryBuildStateV2 {
	readonly id: string;
	readonly schemaVersion: 2;
	readonly ready: boolean;
	readonly afterKey: string | null;
	readonly indexedCount: number;
}

export function readPhotoQueryBuildStateV2(value: unknown, catalogId: string): PhotoQueryBuildStateV2 {
	const catalog = id(catalogId, 'query2 build catalog');
	const input = record(value, 'photo query2 build state', ['id', 'schemaVersion', 'ready', 'afterKey', 'indexedCount']);
	if (field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported or future photo query2 build version.');
	if (id(field(input, 'id'), 'query2 build catalog') !== catalog) throw new TypeError('Query2 build belongs to another catalog.');
	const afterKey = field(input, 'afterKey');
	if (afterKey !== null) {
		if (typeof afterKey !== 'string' || !afterKey.startsWith(`${catalog}|`)) throw new TypeError('Query2 build cursor belongs to another catalog.');
		id(afterKey.slice(catalog.length + 1), 'query2 build photo');
	}
	return Object.freeze({ id: catalog, schemaVersion: 2, ready: boolean(field(input, 'ready'), 'query2 build readiness'),
		afterKey, indexedCount: integer(field(input, 'indexedCount'), 0, LIGHTSCAPER_CATALOG_LIMITS.maximumPhotos, 'query2 indexed count') });
}
