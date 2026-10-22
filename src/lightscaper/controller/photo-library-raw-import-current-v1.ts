/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import type { PhotoLibraryRawFrameCurrentV1, PhotoLibraryRawResultCurrentV1 } from './photo-library-raw-source-current-v1.ts';
export interface PhotoLibraryRawImportRequestCurrentV1 {
 readonly body: Blob; readonly contentSha256: string; readonly profile: 'canonical';
}
export interface PhotoLibraryRawImportFrameCurrentV1 extends PhotoLibraryRawFrameCurrentV1 {
 readonly input: Readonly<{ byteLength: number; contentSha256: string }>;
}
export interface PhotoLibraryRawImportSourceCurrentV1 {
 withFrame<Result>(request: Readonly<PhotoLibraryRawImportRequestCurrentV1>, consume: (view: Readonly<PhotoLibraryRawImportFrameCurrentV1>) => Result | Promise<Result>,
  options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryRawResultCurrentV1<Result>>;
}
/** Local client preparation only. Main uploads/rechecks these actual bytes and
 * consumes its own opaque completed-file proof before entering native work. */
export function readPhotoLibraryRawImportRequestCurrentV1(value: unknown): Readonly<PhotoLibraryRawImportRequestCurrentV1> {
 const input = record(value, 'native RAW import request', ['body', 'contentSha256', 'profile']);
 const body = canonicalMediaContentBlob(field(input, 'body', 'native RAW import request')), sha = field(input, 'contentSha256', 'native RAW import request');
 if (field(input, 'profile', 'native RAW import request') !== 'canonical' || typeof sha !== 'string' || !/^[a-f0-9]{64}$/u.test(sha)
  || body.size < 1 || body.size > 64 * 1024 * 1024) throw new RangeError('Native import requires its bounded full RAW body and canonical profile.');
 return Object.freeze({ body, contentSha256: sha, profile: 'canonical' });
}
export function capturePhotoLibraryRawImportSourceCurrentV1(value: undefined): undefined;
export function capturePhotoLibraryRawImportSourceCurrentV1(value: PhotoLibraryRawImportSourceCurrentV1): Readonly<PhotoLibraryRawImportSourceCurrentV1>;
export function capturePhotoLibraryRawImportSourceCurrentV1(value: unknown): Readonly<PhotoLibraryRawImportSourceCurrentV1> | undefined;
export function capturePhotoLibraryRawImportSourceCurrentV1(value: unknown): Readonly<PhotoLibraryRawImportSourceCurrentV1> | undefined {
 if (value === undefined) return undefined;
 if (value === null || typeof value !== 'object') throw new TypeError('Native RAW import requires an actual scoped local source.');
 const withFrame: unknown = Reflect.get(value, 'withFrame');
 if (typeof withFrame !== 'function') throw new TypeError('Native RAW import requires its scoped frame method.');
 return Object.freeze<PhotoLibraryRawImportSourceCurrentV1>({ withFrame: <Result>(request: Readonly<PhotoLibraryRawImportRequestCurrentV1>,
  consume: (view: Readonly<PhotoLibraryRawImportFrameCurrentV1>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) =>
  Reflect.apply(withFrame, value, [request, consume, options]) as Promise<PhotoLibraryRawResultCurrentV1<Result>> });
}
