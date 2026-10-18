/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import type { PhotoLibraryRestoreReceiptV1 } from '../common/editor/photo-library-restore-port-v1.ts';
import { DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES } from '../common/editor/desktop-read-profile.ts';
import { array, id, name } from './catalog/value-validation.ts';
export const DESKTOP_PHOTO_LIBRARY_RESTORE_CHANNELS_CURRENT_V1 = Object.freeze({
	begin: 'lightscaper:v1:photo-library-restore:begin', write: 'lightscaper:v1:photo-library-restore:write',
	commit: 'lightscaper:v1:photo-library-restore:commit', abort: 'lightscaper:v1:photo-library-restore:abort',
});
export const DESKTOP_PHOTO_LIBRARY_RESTORE_CHUNK_BYTES_CURRENT_V1 = 1_048_576;
const LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'byteLength')!.get!;
const BUFFER = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype) as object, 'buffer')!.get!;
const NativeBytes = Uint8Array;
export function readDesktopPhotoLibraryRestoreIdCurrentV1(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Native restore requires its opaque stream ID.'); return value;
}
export function readDesktopPhotoLibraryRestoreBeginCurrentV1(value: unknown): Readonly<{ name: string; byteLength: number }> {
	const row = record(value, 'native restore begin', ['name','byteLength']);
	return Object.freeze({ name: name(field(row,'name','native restore begin'),'catalog name'), byteLength: integer(field(row,'byteLength','native restore begin'),1,DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES) });
}
export function readDesktopPhotoLibraryRestoreWriteCurrentV1(value: unknown): Readonly<{ id: string; offset: number; bytes: Uint8Array<ArrayBuffer> }> {
	const row = record(value, 'native restore write', ['id','offset','bytes']), selectedId = readDesktopPhotoLibraryRestoreIdCurrentV1(field(row,'id','native restore write'));
	const offset = integer(field(row,'offset','native restore write'),0,DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES), valueBytes = field(row,'bytes','native restore write');
	if (!(valueBytes instanceof NativeBytes) || !(Reflect.apply(BUFFER,valueBytes,[]) instanceof ArrayBuffer)) throw new TypeError('Native restore needs actual private Uint8Array bytes.');
	const length: unknown = Reflect.apply(LENGTH,valueBytes,[]); integer(length,1,DESKTOP_PHOTO_LIBRARY_RESTORE_CHUNK_BYTES_CURRENT_V1);
	return Object.freeze({ id: selectedId, offset, bytes: new NativeBytes(valueBytes) });
}
export function readDesktopPhotoLibraryRestoreCommitCurrentV1(value: unknown): Readonly<{ id: string; contentSha256: string }> {
	const row = record(value, 'native restore commit', ['id','contentSha256']);
	return Object.freeze({ id: readDesktopPhotoLibraryRestoreIdCurrentV1(field(row,'id','native restore commit')), contentSha256: readDesktopPhotoLibraryRestoreIdCurrentV1(field(row,'contentSha256','native restore commit')) });
}
export function readDesktopPhotoLibraryRestoreAbortCurrentV1(value: unknown): Readonly<{ id: string }> {
	const row = record(value, 'native restore abort', ['id']); return Object.freeze({ id: readDesktopPhotoLibraryRestoreIdCurrentV1(field(row,'id','native restore abort')) });
}
export function readDesktopPhotoLibraryRestoreBeginReceiptCurrentV1(value: unknown): Readonly<{ id: string; maximumChunkBytes: number }> {
	const row = record(value, 'native restore stream', ['id','maximumChunkBytes']);
	if (field(row,'maximumChunkBytes','native restore stream') !== DESKTOP_PHOTO_LIBRARY_RESTORE_CHUNK_BYTES_CURRENT_V1) throw new TypeError('Unexpected native restore chunk bound.');
	return Object.freeze({ id: readDesktopPhotoLibraryRestoreIdCurrentV1(field(row,'id','native restore stream')), maximumChunkBytes: DESKTOP_PHOTO_LIBRARY_RESTORE_CHUNK_BYTES_CURRENT_V1 });
}
export function readDesktopPhotoLibraryRestoreWriteReceiptCurrentV1(value: unknown): number {
	const row = record(value, 'native restore write ACK', ['bytesWritten']); return integer(field(row,'bytesWritten','native restore write ACK'),0,DESKTOP_SCAPE_READ_HARD_LIMIT_BYTES);
}
export function readDesktopPhotoLibraryRestoreReceiptCurrentV1(value: unknown): Readonly<PhotoLibraryRestoreReceiptV1> {
	const row = record(value, 'native restore receipt', ['catalogId','catalogName','photoCount','stackCount','savedCollectionCount','originalCount','originalByteLength','notices']);
	const notices = array(field(row,'notices','native restore receipt'),'native restore notices',0,2).map(value => {
		if (value !== 'cleanup-failed' && value !== 'publication-reconciled') throw new TypeError('Invalid native restore notice.'); return value; });
	if (new Set(notices).size !== notices.length) throw new TypeError('Duplicate native restore notices.');
	return Object.freeze({ catalogId: id(field(row,'catalogId','native restore receipt'),'catalog ID'), catalogName: name(field(row,'catalogName','native restore receipt'),'catalog name'),
	photoCount: integer(field(row,'photoCount','native restore receipt'),0,Number.MAX_SAFE_INTEGER), stackCount: integer(field(row,'stackCount','native restore receipt'),0,Number.MAX_SAFE_INTEGER),
	savedCollectionCount: integer(field(row,'savedCollectionCount','native restore receipt'),0,Number.MAX_SAFE_INTEGER), originalCount: integer(field(row,'originalCount','native restore receipt'),0,Number.MAX_SAFE_INTEGER),
	originalByteLength: integer(field(row,'originalByteLength','native restore receipt'),0,Number.MAX_SAFE_INTEGER), notices: Object.freeze(notices) });
}
function integer(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value,-0) || value < minimum || value > maximum) throw new RangeError('Native restore has an invalid exact integer.'); return value;
}
