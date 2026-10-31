/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';

/** Native SQL fixtures stay independent of browser query repository code. */
export function nativeCatalogRootCurrentV1() {
	return normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog', name: 'Native pages', revision: 0, photoCount: 0,
		folders: [{ id: 'folder', name: 'Folder', parentId: null }],
		keywords: [{ id: 'keyword', name: 'Landscape', parentId: null }],
		collections: [{ id: 'manual', name: 'Manual', kind: 'manual' },
			{ id: 'smart', name: 'Smart', kind: 'smart', query: { kind: 'rating', minimum: 4, maximum: 5 } }],
	});
}

export function nativePhotoCurrentV1(index = 0) {
	const template = photoArchiveFixture(index).photo, photoId = `photo-${String(index).padStart(6, '0')}`;
	const fileName = `Image-${String(100_000 - index).padStart(6, '0')}.jpg`;
	return normalizePhotoDocumentCurrentV1({ ...template, id: photoId, catalogId: 'catalog',
		metadata: { ...template.metadata, fileName, captureTime: index % 3 === 0 ? null : {
			local: `2026-01-${String(1 + index % 28).padStart(2, '0')}T12:00:00.000`, offsetMinutes: null } },
		folderId: 'folder', collectionIds: ['manual'], keywordIds: index % 2 === 0 ? ['keyword'] : [], rating: index % 6 });
}
