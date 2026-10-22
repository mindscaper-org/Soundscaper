/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryCullingNavigationContextV1 } from '../../common/editor/photo-library-culling-navigation-port-v1.ts';
import { normalizePhotoCatalogQueryV1 } from './photo-query-types-v1.ts';
import { normalizePhotoCatalogQueryV2 } from './photo-query-types-v2.ts';
import { assertPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { field, id, record } from './value-validation.ts';

/** No caller-owned cursor or inclusive switch crosses this admission boundary. */
export function admitPhotoCullingNavigationV1(contextValue: unknown, value: unknown) {
	const input = record(value, 'culling destination request', ['photoId', 'signal'], ['photoId']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const selected = record(contextValue, 'culling destination context', ['kind', 'query', 'collectionId', 'collapsed'], ['kind']);
	const kind = field(selected, 'kind'); let context: PhotoLibraryCullingNavigationContextV1;
	if (kind === 'plain') { record(contextValue, 'plain culling context', ['kind']); context = Object.freeze({ kind }); }
	else if (kind === 'query' || kind === 'saved') {
		record(contextValue, 'queried culling context', kind === 'query' ? ['kind', 'query', 'collapsed'] : ['kind', 'collectionId', 'collapsed']);
		const collapsed = field(selected, 'collapsed'); if (typeof collapsed !== 'boolean') throw new TypeError('Culling grouping mode must be explicit.');
		if (kind === 'saved') context = Object.freeze({ kind, collectionId: id(field(selected, 'collectionId'), 'culling saved collection ID'), collapsed });
		else {
			const queryValue = field(selected, 'query');
			const query = queryValue !== null && typeof queryValue === 'object' && Object.hasOwn(queryValue, 'schemaVersion')
				? normalizePhotoCatalogQueryV2(queryValue) : normalizePhotoCatalogQueryV1(queryValue);
			context = Object.freeze({ kind, query, collapsed });
		}
	} else throw new RangeError('Unknown culling destination context.');
	return Object.freeze({ context, photoId: id(field(input, 'photoId'), 'culling destination photo ID'), ...(signal === undefined ? {} : { signal }) });
}
