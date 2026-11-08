/* SPDX-License-Identifier: AGPL-3.0-only */

import type { SQLInputValue } from 'node:sqlite';
import type { PhotoCatalogQueryV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import type { PhotoQueryInclusivePosition } from '../src/lightscaper/catalog/photo-query-position.ts';
import { lightscaperNativeQueryFileNameKeyCurrentV1 } from './lightscaper-native-query-records-current-v1.ts';

/** Shared physical tuple only. Owning wrappers choose their fixed table and
 * strict Row1/Row2 reader. Position comes only from a trusted point admission;
 * an actual continuation/after key always takes exclusive precedence. */
export function lightscaperNativeQuerySeekStatementCurrentV1(catalogId: string, query: PhotoCatalogQueryV1,
	bucket: 0 | 1, after: readonly (string | number)[] | null, position?: PhotoQueryInclusivePosition): Readonly<{ suffix: string; parameters: SQLInputValue[] }> {
	const field = query.sort.field, descending = query.sort.direction === 'descending';
	const direction = descending ? 'DESC' : 'ASC', inclusive = after === null && position !== undefined;
	const comparison = descending ? inclusive ? '<=' : '<' : inclusive ? '>=' : '>';
	const columns = field === 'file-name' ? ['file_name_key', 'photo_id'] : field === 'rating' ? ['rating_sort', 'photo_id']
		: field === 'capture-time' ? ['capture_sort', 'photo_id'] : ['photo_id'];
	const where = ['catalog_id=?'], parameters: SQLInputValue[] = [catalogId], selected = after ?? position?.key ?? null;
	if (field === 'capture-time') { where.push('capture_bucket=?'); parameters.push(bucket); }
	if (selected !== null) {
		const values = field === 'file-name' ? [lightscaperNativeQueryFileNameKeyCurrentV1(selected[1] as string), selected.at(-1)!]
			: field === 'capture-time' ? selected.slice(2) : selected.slice(1);
		where.push(columns.length === 1 ? `${columns[0]!} ${comparison} ?` : `(${columns.join(',')}) ${comparison} (?,?)`);
		parameters.push(...values);
	}
	return Object.freeze({ suffix: `WHERE ${where.join(' AND ')} ORDER BY ${columns.map(column => `${column} ${direction}`).join(',')} LIMIT 1`, parameters });
}
