/* SPDX-License-Identifier: AGPL-3.0-only */

import { capturePhotoLibraryRawSourceCurrentV1 } from '../controller/photo-library-raw-source-current-v1.ts';
import { withPhotoLibraryRawPreviewCurrentV1 } from '../controller/photo-library-raw-frame-current-v1.ts';
import type { PhotoLibraryOriginalSourceCurrentV1 } from '../controller/photo-library-original-source-current-v1.ts';
import { planPhotoNativeRawPreviewCurrentV1, preparePhotoNativeRawPreviewCurrentV1, type PhotoNativeRawPreviewPlanCurrentV1, type PreparedPhotoNativeRawPreviewCurrentV1 } from './photo-native-raw-preview-current-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { oneOf } from '../catalog/value-validation.ts';
import { PHOTO_PREVIEW_PROTOCOL_V1 } from './photo-preview-protocol-v1.ts';
import { planPhotoCullingPreviewCurrentV1, type PhotoCullingPreviewPlanCurrentV1 } from './photo-culling-preview-plan-current-v1.ts';
import { preparePhotoCullingPreviewCurrentV1, type PreparedPhotoCullingPreviewCurrentV1 } from './photo-culling-preview-preparation-current-v1.ts';
import type { PhotoPreviewPlanV1 } from './photo-preview-plan-v1.ts';
import type { PreparedPhotoPreviewV1 } from './photo-preview-preparation-v1.ts';
import type { PhotoPreviewProtocolCore } from './photo-preview-scheduler-core.ts';
import type { withPhotoCullingFrameCurrentV1 } from './photo-culling-frame-current-v1.ts';
import { capturePhotoOriginalBindingCurrentV1, PHOTO_HDR_ORIGINAL_MIME_CURRENT_V1 } from './photo-original-binding-current-v1.ts';
import { planPhotoHdrPreviewCurrentV1, type PhotoHdrPreviewPlanCurrentV1 } from './photo-hdr-preview-plan-current-v1.ts';
import { preparePhotoHdrPreviewCurrentV1, type PreparedPhotoHdrPreviewCurrentV1 } from './photo-hdr-preview-preparation-current-v1.ts';
import type { withPhotoOriginalFrameCurrentV1 } from './photo-original-frame-current-v1.ts';

export type PhotoPreviewPlanCurrentV1 = PhotoPreviewPlanV1 | PhotoCullingPreviewPlanCurrentV1 | PhotoHdrPreviewPlanCurrentV1 | PhotoNativeRawPreviewPlanCurrentV1;
export type PreparedPhotoPreviewCurrentV1 = PreparedPhotoPreviewV1 | PreparedPhotoCullingPreviewCurrentV1 | PreparedPhotoHdrPreviewCurrentV1 | PreparedPhotoNativeRawPreviewCurrentV1;

/** Both source choices share one bounded demand queue. Ordinary raster and the
 * neutral default retain the exact permanent Original recipe and cache. */
export function createPhotoPreviewProtocolCurrentV1(receiver: object, configured?: typeof withPhotoCullingFrameCurrentV1, configuredHdr?: typeof withPhotoOriginalFrameCurrentV1, originalSource?: PhotoLibraryOriginalSourceCurrentV1):
Readonly<PhotoPreviewProtocolCore<PreparedPhotoPreviewCurrentV1, PhotoPreviewPlanCurrentV1>> {
	const raw = capturePhotoLibraryRawSourceCurrentV1(originalSource?.raw);
	return Object.freeze<PhotoPreviewProtocolCore<PreparedPhotoPreviewCurrentV1, PhotoPreviewPlanCurrentV1>>({
		capture(value) {
			const input = record(value, 'Current culling job', ['photoId', 'tier', 'signal', 'rawPreviewSource'], ['photoId', 'tier']);
			const old = PHOTO_PREVIEW_PROTOCOL_V1.capture({ photoId: field(input, 'photoId', 'Current culling job'),
				tier: field(input, 'tier', 'Current culling job'), ...(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal', 'Current culling job') } : {}) });
			const variant = Object.hasOwn(input, 'rawPreviewSource') ? oneOf(field(input, 'rawPreviewSource', 'Current culling job'),
				['neutral-original', 'camera-embedded'] as const, 'RAW preview source') : 'neutral-original';
			return Object.freeze({ ...old, variant });
		},
		async withSource({ plan, binding, photo, signal, variant }, consume, fallback) {
			if (plan.kind !== 'photo-native-raw-preview-plan') return fallback();
			if (!raw) throw new TypeError('Native preview plan has no captured actual source.');
			const result = await withPhotoLibraryRawPreviewCurrentV1(raw, { catalogId: photo.catalogId, photoId: photo.id,
				original: photo.original, expectedRevision: null, tier: plan.tier }, view => consume(preparePhotoNativeRawPreviewCurrentV1(plan, view)), signal);
			if (result.outcome === 'native') return result.value;
			// Entire native callback/reader/child has joined. This whole fallback
			// keeps the permanent Web recipe and can hit its own genuine cache.
			return fallback(PHOTO_PREVIEW_PROTOCOL_V1.plan(binding, plan.tier, photo, variant));
		},
		plan(binding, tier, photo, variant) {
			if (raw && variant !== 'camera-embedded' && ['image/x-adobe-dng', 'image/x-canon-crw'].includes(photo.original.mimeType ?? '')) return planPhotoNativeRawPreviewCurrentV1({ binding, tier });
			if (photo.original.mimeType === PHOTO_HDR_ORIGINAL_MIME_CURRENT_V1) return planPhotoHdrPreviewCurrentV1({
				binding: capturePhotoOriginalBindingCurrentV1(binding, photo.original), tier });
			return variant === 'camera-embedded' && ['image/x-adobe-dng', 'image/x-canon-crw'].includes(photo.original.mimeType)
				? planPhotoCullingPreviewCurrentV1({ binding, tier, source: 'camera-embedded' })
				: PHOTO_PREVIEW_PROTOCOL_V1.plan(binding, tier, photo, '');
		},
		async render({ plan, binding, body, signal, variant }, regenerate) {
			if (plan.kind === 'photo-native-raw-preview-plan') throw new TypeError('Native preview must retain its actual scoped source through publication.');
			if (plan.kind === 'photo-preview-plan') return PHOTO_PREVIEW_PROTOCOL_V1.render({ plan, binding, body, signal, variant }, regenerate);
			if (plan.kind === 'photo-hdr-preview-plan') {
				const produce = configuredHdr ?? (await import('./photo-original-frame-current-v1.ts')).withPhotoOriginalFrameCurrentV1;
				return Reflect.apply(produce, receiver, [{ binding: plan.binding, body, signal },
					(frame: Parameters<Parameters<typeof withPhotoOriginalFrameCurrentV1>[1]>[0]) =>
						preparePhotoHdrPreviewCurrentV1({ plan, binding: plan.binding, frame, signal })]) as Promise<Readonly<PreparedPhotoHdrPreviewCurrentV1>>;
			}
			const produce = configured ?? (await import('./photo-culling-frame-current-v1.ts')).withPhotoCullingFrameCurrentV1;
			return Reflect.apply(produce, receiver, [{ binding, body, source: 'camera-embedded', signal },
				(frame: Parameters<Parameters<typeof withPhotoCullingFrameCurrentV1>[1]>[0], provenance: Parameters<Parameters<typeof withPhotoCullingFrameCurrentV1>[1]>[1]) =>
					preparePhotoCullingPreviewCurrentV1({ plan, binding, frame, signal, representation: provenance.representation })]) as Promise<Readonly<PreparedPhotoCullingPreviewCurrentV1>>;
		},
	});
}
