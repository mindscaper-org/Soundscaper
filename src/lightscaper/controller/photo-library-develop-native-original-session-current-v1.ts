/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoLibraryDevelopOriginalPortV1, PhotoLibraryDevelopOriginalReadV1, PhotoLibraryDevelopOriginalFrameV1 } from '../../common/editor/photo-library-develop-original-port-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { id, integer } from '../catalog/value-validation.ts';
import { withPhotoLibraryRawFrameCurrentV1 } from './photo-library-raw-frame-current-v1.ts';
import type { PhotoLibraryRawSourceCurrentV1, PhotoLibraryRawResultCurrentV1 } from './photo-library-raw-source-current-v1.ts';
import type { PhotoLibraryDevelopOriginalSessionHostCurrentV1 as Host } from './photo-library-develop-original-session-current-v1.ts';

/** Current-only route. Legacy fixed byte readers never discover a successor
 * decoder simply because they share the same selected Original source. */
export function createPhotoLibraryDevelopNativeOriginalSessionCurrentV1(host: Host, source: Readonly<PhotoLibraryRawSourceCurrentV1>,
 fallback: Readonly<PhotoLibraryDevelopOriginalPortV1>): Readonly<PhotoLibraryDevelopOriginalPortV1> {
 const ready = host.ready, operation = host.operation, repository = host.repository, load = repository.loadPhoto;
 const withFallback = fallback.withFrame;
 return Object.freeze<PhotoLibraryDevelopOriginalPortV1>({ withFrame: async <Value>(value: PhotoLibraryDevelopOriginalReadV1,
  consume: (view: Readonly<PhotoLibraryDevelopOriginalFrameV1>) => Value | Promise<Value>, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Value> => {
  const signal = captureRepairSignalV1(Object.getOwnPropertyDescriptor(options, 'signal')?.value); checkRepairSignalV1(signal);
  const config = record(options, 'native Current Original options', ['signal'], []);
  if ((Object.hasOwn(config, 'signal') ? field(config, 'signal', 'native Current Original options') : undefined) !== signal) throw new TypeError('Native Original signal changed during capture.');
  const input = record(value, 'Current native Original request', ['schemaVersion', 'photoId', 'expectedRevision']);
  if (field(input, 'schemaVersion', 'Current native Original request') !== 1 || typeof consume !== 'function') throw new TypeError('Current Original requires its request and scoped consumer.');
  const photoId = id(field(input, 'photoId', 'Current native Original request'), 'Current Original photo');
  const revision = integer(field(input, 'expectedRevision', 'Current native Original request'), 0, Number.MAX_SAFE_INTEGER, 'Current Original revision');
  const capturedRequest = Object.freeze<PhotoLibraryDevelopOriginalReadV1>({ schemaVersion: 1, photoId, expectedRevision: revision });
  const capturedOptions = Object.freeze(signal === undefined ? {} : { signal });
  const result = await Reflect.apply(operation, host, [async (admitted: AbortSignal) => {
   const catalogId = await Reflect.apply(ready, host, []) as string;
   const current = async () => {
    checkRepairSignalV1(admitted); const raw = await Reflect.apply(load, repository, [catalogId, photoId]) as unknown; checkRepairSignalV1(admitted);
    if (!raw) throw new ReferenceError('Current native Original Photo is missing.');
    const photo = normalizePhotoDocumentCurrentV1(raw);
    if (photo.catalogId !== catalogId || photo.id !== photoId || photo.revision !== revision) throw new PhotoCatalogRevisionConflictError('photo'); return photo;
   };
   const photo = await current(), identity = JSON.stringify(photo.original);
   const fence = async () => { if (JSON.stringify((await current()).original) !== identity) throw new PhotoCatalogRevisionConflictError('photo'); };
   return withPhotoLibraryRawFrameCurrentV1(source, { catalogId, photoId, original: photo.original, expectedRevision: revision, profile: 'canonical' }, async view => {
    await fence(); const result = await consume(Object.freeze({ photoId, revision, frame: view.frame })); await fence(); return result;
   }, admitted);
  }, signal]) as PhotoLibraryRawResultCurrentV1<Value>;
  if (result.outcome === 'native') return result.value;
  // Entire native scope/plane/prepared child has retired. The permanent Web
  // implementation owns a fresh complete operation and genuine Blob fallback.
  checkRepairSignalV1(signal); return Reflect.apply(withFallback, fallback, [capturedRequest, consume, capturedOptions]) as Promise<Value>;
 } });
}
