/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../../src/lightscaper/catalog/photo-document-current-v1.ts';
import { readDesktopPhotoOriginalRequestCurrentV1, readDesktopPhotoOriginalTicketCurrentV1,
	type DesktopPhotoOriginalTicketCurrentV1 } from '../../../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
import { readDesktopPhotoOriginalGroupTicketIdCurrentV1 } from '../../../src/lightscaper/desktop-photo-original-group-contract-current-v1.ts';
import { readPhotoLibraryOriginalGroupCurrentV1 } from '../../../src/lightscaper/controller/photo-library-original-group-contract-current-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../../src/common/editor/closed-domain-value.ts';
import { photoArchiveFixture } from '../../helpers/lightscaper-photo-fixture.ts';
import { rawDngFixtureV1 } from '../../helpers/lightscaper-raw-dng-current-fixture.ts';
import { pngChunk } from '../../helpers/image-metadata-fixtures.ts';
import { nativeResourceRootCurrentV1 } from '../../helpers/lightscaper-native-photo-resources-integration-fixture-current.ts';
import { managedMediaIntegrationReferenceCurrentV1 } from '../../helpers/lightscaper-native-managed-media-integration-fixture-current.ts';

export const ORIGINAL_TRANSPORT_BROWSER_ROOT_CURRENT_V1 = '/__lightscaper_native_original_transport__';
export type NativeOriginalBrowserKindCurrentV1 = 'raster' | 'raw';
export type NativeOriginalBrowserFixtureCurrentV1 = Awaited<ReturnType<typeof openNativeOriginalBrowserFixtureCurrentV1>>;
const RANGE = 1024 * 1024;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Literal four-color PNG plus a valid private ancillary chunk forces two real
 * native range pulls without a large image plane or invented decoder pixels. */
function raster() {
	const pixels = Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255);
	const header = new Uint8Array(13); new DataView(header.buffer).setUint32(0, 2); new DataView(header.buffer).setUint32(4, 2); header.set([8, 6], 8);
	const rows = new Uint8Array(18); rows.set(pixels.subarray(0, 8), 1); rows.set(pixels.subarray(8), 10);
	const bytes = new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
		pngChunk('npAD', new Uint8Array(RANGE + 17)), pngChunk('IDAT', new Uint8Array(deflateSync(rows))), pngChunk('IEND', new Uint8Array())]));
	return { bytes, width: 2, height: 2, mimeType: 'image/png', name: 'Native two-range.png', pixels };
}

/** Genuine guarded native generation, FS, SQLite, catalog verification and
 * permanent Root1. The binding below forwards into its actual ticket server. */
export async function openNativeOriginalBrowserFixtureCurrentV1(kind: NativeOriginalBrowserKindCurrentV1, options: Readonly<{ aliases?: boolean }> = {}) {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-original-browser-')));
	let scopes: Scopes | undefined, primary: unknown;
	try {
		scopes = await Scopes.open({ appDataPath: directory });
		const scope = await scopes.allocate('catalog-1'), components = await scopes.openComponents(scope);
		const source = kind === 'raster' ? raster() : { bytes: rawDngFixtureV1().bytes, width: 32, height: 32,
			mimeType: 'image/x-adobe-dng', name: 'Native owned sensor.dng', pixels: new Uint8Array() };
		const seed = photoArchiveFixture(901, source.bytes).photo;
		const photo = normalizePhotoDocumentCurrentV1({ ...seed, original: { ...seed.original, name: source.name,
			mimeType: source.mimeType, width: source.width, height: source.height }, metadata: { ...seed.metadata, fileName: source.name } });
		const alias = photoArchiveFixture(902, source.bytes).photo;
		const photos = [photo, ...(options.aliases ? [normalizePhotoDocumentCurrentV1({ ...alias,
			original: { ...alias.original, name: source.name, mimeType: source.mimeType, width: source.width, height: source.height },
			metadata: { ...alias.metadata, fileName: source.name } })] : [])];
		await components.catalog.createCatalog(nativeResourceRootCurrentV1());
		for (const selected of photos) await components.media.writeAsset(selected.original.storageKey, new Blob([source.bytes], { type: source.mimeType }), { name: source.name, mimeType: source.mimeType });
		await components.catalog.publishPhotos('catalog-1', 0, photos);
		const references = photos.map(selected => managedMediaIntegrationReferenceCurrentV1(selected.original, selected.id));
		await components.media.catalogOriginals.retain('catalog-1', references);
		const request = Object.freeze({ catalogId: 'catalog-1', photoId: photo.id, original: photo.original });
		const requests = Object.freeze(photos.map(selected => Object.freeze({ catalogId: selected.catalogId, photoId: selected.id, original: selected.original })));
		const transport = components.originalTickets.transport;
		const observations = { opened: 0, closed: 0, ranges: [] as Array<readonly [number, number]>,
			groupsOpened: 0, groupsClosed: 0, groupRanges: [] as Array<readonly [number, number, number]> };
		let closing: Promise<void> | undefined, retiring: Promise<void> | undefined;
		const retireNative = (): Promise<void> => { retiring ??= scopes!.close(); return retiring; };
		return { request, requests, kind, transport, byteLength: source.bytes.byteLength, sha256: digest(source.bytes), pixels: [...source.pixels], observations,
			async install(page: Page): Promise<void> {
				await page.exposeBinding('__lightscaperOriginalTransportCurrentV1', async (caller, value: unknown) => {
					if (caller.page !== page || caller.frame !== page.mainFrame()) throw new Error('Native Original qualification binding belongs to its actual main page.');
					const operation = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'operation')?.value as unknown : undefined;
					if (operation === 'open') {
						const input = record(value, 'Original qualification open', ['operation', 'request']);
						const result = await transport.open(readDesktopPhotoOriginalRequestCurrentV1(field(input, 'request', 'Original qualification open')));
						observations.opened++; return result;
					}
					if (operation === 'read') {
						const input = record(value, 'Original qualification read', ['operation', 'ticket', 'offset', 'length']);
						const ticket = readDesktopPhotoOriginalTicketCurrentV1(field(input, 'ticket', 'Original qualification read'), request);
						const offset: unknown = field(input, 'offset', 'Original qualification read'), length: unknown = field(input, 'length', 'Original qualification read');
						assert.ok(typeof offset === 'number' && typeof length === 'number' && Number.isSafeInteger(length) && length >= 1 && length <= RANGE);
						const bytes = await transport.read(ticket, offset, length); assert.ok(bytes instanceof Uint8Array); assert.equal(bytes.byteLength, length);
						observations.ranges.push([offset, length]);
						try { return { offset, length, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') }; }
						finally { bytes.fill(0); }
					}
					if (operation === 'close') {
						const input = record(value, 'Original qualification close', ['operation', 'ticket']);
						await transport.close(field(input, 'ticket', 'Original qualification close') as Readonly<Pick<DesktopPhotoOriginalTicketCurrentV1, 'id'>>);
						observations.closed++; return true;
					}
					if (operation === 'openGroup') {
						const input = record(value, 'Original qualification group open', ['operation', 'requests']);
						const selected = readPhotoLibraryOriginalGroupCurrentV1(field(input, 'requests', 'Original qualification group open')).requests;
						assert.equal(JSON.stringify(selected), JSON.stringify(requests)); assert.equal(typeof transport.openGroup, 'function');
						const result = await transport.openGroup!(selected); observations.groupsOpened++; return result;
					}
					if (operation === 'readGroup') {
						const input = record(value, 'Original qualification group read', ['operation', 'group', 'index', 'offset', 'length']);
						const id = readDesktopPhotoOriginalGroupTicketIdCurrentV1(field(input, 'group', 'Original qualification group read'));
						const index: unknown = field(input, 'index', 'Original qualification group read'), offset: unknown = field(input, 'offset', 'Original qualification group read'), length: unknown = field(input, 'length', 'Original qualification group read');
						assert.ok(typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < requests.length);
						assert.ok(typeof offset === 'number' && typeof length === 'number' && Number.isSafeInteger(length) && length >= 1 && length <= RANGE);
						assert.equal(typeof transport.readGroup, 'function'); const bytes = await transport.readGroup!({ id }, index, offset, length);
						assert.ok(bytes instanceof Uint8Array); assert.equal(bytes.byteLength, length); observations.groupRanges.push([index, offset, length]);
						try { return { index, offset, length, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') }; }
						finally { bytes.fill(0); }
					}
					if (operation === 'closeGroup') {
						const input = record(value, 'Original qualification group close', ['operation', 'group']);
						const id = readDesktopPhotoOriginalGroupTicketIdCurrentV1(field(input, 'group', 'Original qualification group close'));
						assert.equal(typeof transport.closeGroup, 'function'); await transport.closeGroup!({ id }); observations.groupsClosed++; return true;
					}
					throw new TypeError('Unknown native Original qualification operation.');
				});
			},
			async provePinned(): Promise<void> {
				let failure: unknown, refused = false;
				await components.media.catalogOriginals.release('catalog-1', photos.map(selected => selected.id));
				for (const selected of photos) {
					let pinned = false; try { await components.media.deleteAsset(selected.original.storageKey); } catch { pinned = true; }
					if (!pinned) { refused = false; break; } refused = true;
				}
				try { assert.equal(refused, true, 'Actual native reader pin must refuse deletion without a permanent custody root.'); }
				catch (error) { failure = error; }
				try { await components.media.catalogOriginals.retain('catalog-1', references); }
				catch (cleanup) { throw new AggregateError(failure === undefined ? [cleanup] : [failure, cleanup], 'Native pin probe/root restoration failed.', { cause: cleanup }); }
				if (failure !== undefined) throw failure;
			},
			async proveReleased(): Promise<void> {
				await components.media.catalogOriginals.release('catalog-1', photos.map(selected => selected.id));
				for (const selected of photos) { await components.media.deleteAsset(selected.original.storageKey);
					assert.equal(await components.media.getAssetMetadata(selected.original.storageKey), null); }
			},
			retireNative,
			close(): Promise<void> {
				closing ??= (async () => { await retireNative(); await rm(directory, { recursive: true, force: false }); })(); return closing;
			} };
	} catch (error) { primary = error; }
	try { await scopes?.close(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native Original browser opening cleanup failed; files retained.', { cause: cleanup }); }
	await rm(directory, { recursive: true, force: false }); throw primary;
}
