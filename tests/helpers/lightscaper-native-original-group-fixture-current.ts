/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { PhotoLibraryOriginalRequestCurrentV1 as Request } from '../../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import type { DesktopPhotoOriginalGroupTicketCurrentV1 as Ticket } from '../../src/lightscaper/desktop-photo-original-group-contract-current-v1.ts';
import { readDesktopPhotoOriginalGroupTicketCurrentV1 as readGroup } from '../../src/lightscaper/desktop-photo-original-group-contract-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { managedMediaIntegrationReferenceCurrentV1 as reference } from './lightscaper-native-managed-media-integration-fixture-current.ts';
import { checkTicketTestSignalCurrentV1 as check, deferred, type TicketFixtureCurrentV1 as Fixture,
	type Originals as Reader, Tickets } from './lightscaper-native-photo-original-ticket-fixture-current.ts';
export { nativeTicketTestCurrentV1 as test, nativeOriginalTicketFixtureCurrentV1 as fixture, deferred,
	holdTicketFileReadCurrentV1 as holdRead, remainsPending, readTicket, exactTicketFailureCurrentV1 as exactFailure,
	ticketShaCurrentV1 as sha, checkTicketTestSignalCurrentV1 as check } from './lightscaper-native-photo-original-ticket-fixture-current.ts';
export { readGroup };
export { Media } from './lightscaper-native-photo-original-ticket-fixture-current.ts';
export { Originals } from './lightscaper-native-photo-original-reader-fixture-current.ts';
export type { Fixture, Request, Ticket };
export interface GroupView { readonly originals: readonly Request['original'][]; read(index: number, offset: number, length: number): Promise<Uint8Array> }
/** The real transport must provide the complete feature. Reflection permits
 * an authentic missing-method RED without inventing a backend or type facade. */
export function groupTransport(server: Tickets) {
	const actual = server.transport, open: unknown = Reflect.get(actual, 'openGroup'), read: unknown = Reflect.get(actual, 'readGroup'), close: unknown = Reflect.get(actual, 'closeGroup');
	for (const method of [open, read, close]) assert.equal(typeof method, 'function', 'Native Original group transport must be complete.');
	return Object.freeze({
		open: (requests: readonly Readonly<Request>[]): Promise<unknown> => Reflect.apply(open as (...args: unknown[]) => Promise<unknown>, actual, [requests]),
		read: (ticket: Readonly<{ id: string }>, index: number, offset: number, length: number): Promise<unknown> => Reflect.apply(read as (...args: unknown[]) => Promise<unknown>, actual, [ticket, index, offset, length]),
		close: (ticket: Readonly<{ id: string }>): Promise<void> => Reflect.apply(close as (...args: unknown[]) => Promise<void>, actual, [ticket]),
	});
}
export function withGroup<Result>(reader: Reader, requests: unknown, consume: (view: Readonly<GroupView>) => Result | PromiseLike<Result>, options = {}): Promise<Result> {
	const method: unknown = Reflect.get(reader, 'withOriginalGroup'); assert.equal(typeof method, 'function', 'Actual native Reader must reserve a complete group.');
	return Reflect.apply(method as (...args: unknown[]) => Promise<Result>, reader, [requests, consume, options]);
}
/** Each alias is a real stored Photo and retains a real custody root. A new
 * locator is written through the native owner, never by inserting provenance. */
export async function seedAliases(f: Fixture, count: number, options: Readonly<{ differentLocator?: boolean; retain?: boolean; prefix?: string }> = {}): Promise<readonly Readonly<Request>[]> {
	const photos = [], requests: Readonly<Request>[] = [];
	for (let index = 0; index < count; index++) {
		check(); const photoId = `${options.prefix ?? 'group'}-photo-${index}`, storageKey = options.differentLocator ? `${options.prefix ?? 'group'}-asset-${index}` : f.entry.original.storageKey;
		if (options.differentLocator) await f.media.writeAsset(storageKey, new Blob([f.entry.bytes]), f.entry.metadata);
		const original = { ...f.entry.original, id: `${options.prefix ?? 'group'}-source-${index}`, name: `Group ${index}.dng`, storageKey };
		const photo = normalizePhotoDocumentCurrentV1({ ...f.entry.photo, id: photoId, original }); photos.push(photo);
		requests.push(Object.freeze({ catalogId: f.request.catalogId, photoId, original: photo.original }));
	}
	let root = await f.catalog.loadCatalog(f.request.catalogId); assert.ok(root);
	for (let offset = 0; offset < photos.length; offset += 16) {
		check(); const batch = photos.slice(offset, offset + 16);
		if (options.retain !== false) await f.media.catalogOriginals.retain(f.request.catalogId, batch.map(photo => reference(photo.original, photo.id)));
		root = await f.catalog.publishPhotos(f.request.catalogId, root.revision, batch);
	}
	return Object.freeze(requests);
}
export async function releaseAliases(f: Fixture, requests: readonly Readonly<Request>[]): Promise<void> {
	for (let offset = 0; offset < requests.length; offset += 16) await f.media.catalogOriginals.release(f.request.catalogId, requests.slice(offset, offset + 16).map(value => value.photoId));
}
/** Native callback, actual SQL and genuine physical pin remain live. The
 * deadline owns release through the existing ALS deferred registry. */
export async function holdSingle(f: Fixture, release = deferred()) {
	const entered = deferred(); const task = f.reader.withOriginal(f.request, async () => { entered.resolve(); await release.promise; });
	void task.catch(() => undefined); await entered.promise; return { task, release };
}
export function observeGroup(reader: Reader, observe: () => void): () => void {
	const method: unknown = Reflect.get(reader, 'withOriginalGroup'); assert.equal(typeof method, 'function');
	const descriptor = Object.getOwnPropertyDescriptor(reader, 'withOriginalGroup');
	Object.defineProperty(reader, 'withOriginalGroup', { configurable: true, value: function (...args: unknown[]) {
		observe(); return Reflect.apply(method as (...values: unknown[]) => unknown, reader, args);
	} });
	return () => { if (descriptor) Object.defineProperty(reader, 'withOriginalGroup', descriptor); else Reflect.deleteProperty(reader, 'withOriginalGroup'); };
}
