/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySessionPortCurrentV1 } from '../../common/editor/photo-library-session-port-current-v1.ts';
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../../common/foundation/closed-domain-value.ts';
import { integer } from '../catalog/value-validation.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { preparePhotoLibraryPreviewReadKernelV2 } from './internal/photo-library-preview-read-kernel-v2.ts';
import { PhotoLibrarySessionKernelV2 } from './photo-library-session-kernel-v2.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from './photo-library-session-ports-current-v1.ts';
import type { PhotoLibraryPreviewReadOptionsCurrentV1 } from '../../common/editor/photo-library-session-port-current-v1.ts';
import type { PhotoLibraryPreviewTierV1 } from '../../common/editor/photo-library-session-port-v1.ts';

/** Named Current admission shares the selected writer, custody and lifetime. */
export class PhotoLibrarySessionCurrentV1 extends PhotoLibrarySessionKernelV2 implements PhotoLibrarySessionPortCurrentV1 {
	declare readonly develop: PhotoLibrarySessionPortCurrentV1['develop'];
	constructor(ports: PhotoLibrarySessionPortsCurrentV1) { super('current3', ports); }
	override async readPreview(photoId: string, tier: PhotoLibraryPreviewTierV1, options: Readonly<PhotoLibraryPreviewReadOptionsCurrentV1> = {}) {
		const input = record(options, 'Current photo preview options', ['signal', 'rawPreviewSource', 'expectedRevision'], []);
		const expected = Object.hasOwn(input, 'expectedRevision') ? integer(field(input, 'expectedRevision', 'Current photo preview options'), 0, Number.MAX_SAFE_INTEGER, 'preview revision') : undefined;
		if (expected !== undefined && Object.is(field(input, 'expectedRevision', 'Current photo preview options'), -0)) throw new RangeError('Preview revision requires an exact nonnegative integer.');
		const request = preparePhotoLibraryPreviewReadKernelV2(true, photoId, tier, {
			...(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal', 'Current photo preview options') } : {}),
			...(Object.hasOwn(input, 'rawPreviewSource') ? { rawPreviewSource: field(input, 'rawPreviewSource', 'Current photo preview options') } : {}),
		});
		const fenced = async () => {
			if (expected === undefined) return;
			const snapshot = await this.develop.read({ schemaVersion: 3, photoId: request.photoId }, { signal: request.signal });
			if (snapshot.revision !== expected) throw new PhotoCatalogRevisionConflictError('photo');
		};
		await fenced();
		const result = await super.readPreview(request.photoId, request.tier, { signal: request.signal, ...(request.rawPreviewSource === undefined ? {} : { rawPreviewSource: request.rawPreviewSource }) });
		await fenced(); return result;
	}
}
