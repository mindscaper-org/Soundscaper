/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopPhotoLibrarySessionStorageCurrentV1 as Storage } from './desktop-photo-library-session-storage-current-v1.ts';
import { DesktopPhotoSessionClientCallsCurrentV1 as Calls, desktopPhotoSignalCurrentV1 as signalOf, desktopPhotoVoidCurrentV1 as empty } from './desktop-photo-library-session-client-calls-current-v1.ts';
import { captureDesktopPhotoCloneCurrentV1, readDesktopPhotoCloneCurrentV1, retireDesktopPhotoCloneCurrentV1, measureDesktopPhotoCloneCurrentV1 } from './desktop-photo-clone-current-v1.ts';
import { canonicalMediaContentBlob } from '../common/editor/storage/media-content-digest.ts';
import { normalizeBinaryDerivativeCacheProfileV1, normalizeBinaryDerivativeCacheIdentityV1 } from '../common/editor/storage/binary-derivative-cache-records.ts';
import { normalizeCatalogOriginalRoot } from '../common/editor/storage/media-catalog-original-schema.ts';
import { normalizeCatalogOriginalRepairBindingV1 } from '../common/editor/storage/media-catalog-original-repair-contract.ts';
import { readDesktopPhotoLibrarySessionHandleCurrentV1 as handle } from './desktop-photo-library-session-protocol-current-v1.ts';
import { uploadDesktopPhotoBlobCurrentV1, openDesktopPhotoUploadCurrentV1, digestDesktopPhotoBlobCurrentV1,
	readDesktopPhotoDownloadCurrentV1, readDesktopPhotoCacheStoreCurrentV1, readDesktopPhotoCacheTrimCurrentV1, desktopPhotoDigestCurrentV1 as digest, desktopPhotoMimeCurrentV1, wipeDesktopPhotoBytesCurrentV1 as wipe } from './desktop-photo-library-session-transfer-client-current-v1.ts';
import { array, field, integer, oneOf, record } from './catalog/value-validation.ts';

type Media = Storage['components']['media'];
const CLONE = structuredClone;
const NAME = typeof File === 'function' ? Object.getOwnPropertyDescriptor(File.prototype, 'name')?.get : undefined;
const MODIFIED = typeof File === 'function' ? Object.getOwnPropertyDescriptor(File.prototype, 'lastModified')?.get : undefined;
export function createDesktopPhotoSessionMediaCurrentV1(c: Calls): Media {
	let metadataPreparing = false;
	const custody: Media['catalogOriginals'] = Object.freeze<Media['catalogOriginals']>({
		retain: (catalogId, references, options = {}) => c.own(() => { c.catalog(catalogId); return c.send('custody', () => ({ operation: 'retain', references }), empty, signalOf(options), false, true); }),
		stage: (catalogId, importId, references, options = {}) => c.own(() => { c.catalog(catalogId); return c.send('custody', () => ({ operation: 'stage', importId, references }), empty, signalOf(options), false, true); }),
		release: (catalogId, photoIds, options = {}) => c.own(() => { c.catalog(catalogId); return c.send('custody', () => ({ operation: 'release', photoIds }), empty, signalOf(options), false, true); }),
		releaseStaged: (catalogId, importId, photoIds, options = {}) => c.own(() => { c.catalog(catalogId); return c.send('custody', () => ({ operation: 'release-staged', importId, photoIds }), empty, signalOf(options), false, true); }),
		promote: (catalogId, importId, photoIds, options = {}) => c.own(() => { c.catalog(catalogId); return c.send('custody', () => ({ operation: 'promote', importId, photoIds }), empty, signalOf(options), false, true); }),
		readPage: (query, options = {}) => c.own(() => c.send('custody', () => {
			const row = record(query, 'custody page request', ['catalogId', 'importId', 'afterKey'], ['catalogId']); c.catalog(field(row, 'catalogId'));
			return { operation: 'page', importId: Object.hasOwn(row, 'importId') ? field(row, 'importId') : null, afterKey: Object.hasOwn(row, 'afterKey') ? field(row, 'afterKey') : null };
		}, value => { const row = record(value, 'custody page', ['roots', 'afterKey']); return Object.freeze({ roots: Object.freeze(array(field(row, 'roots'), 'custody roots', 0, 64).map(v => { const root = normalizeCatalogOriginalRoot(v); c.catalog(root.catalogId); return root; })), afterKey: cursor(field(row, 'afterKey')) }); }, signalOf(options))),
		findDigestPage: (sha256, afterAssetId = null, options = {}) => c.own(() => c.send('custody', () => ({ operation: 'digest-page', sha256, afterAssetId }), value => {
			const row = record(value, 'digest page', ['matches', 'afterAssetId']); return Object.freeze({ matches: Object.freeze(array(field(row, 'matches'), 'digest matches', 0, 64).map(v => {
				const r = record(v, 'digest match', ['assetId', 'sha256', 'size']); return Object.freeze({ assetId: string(field(r, 'assetId')), sha256: digest(field(r, 'sha256')), size: integer(field(r, 'size'), 0, Number.MAX_SAFE_INTEGER, 'original size') }); })), afterAssetId: cursor(field(row, 'afterAssetId')) }); }, signalOf(options))),
	});
	return Object.freeze<Media>({ catalogOriginals: custody,
		writeAsset: (assetId, input, metadata = {}, options = {}) => c.own(async () => {
			if (metadataPreparing) throw new RangeError('Desktop metadata preparation capacity is occupied.');
			metadataPreparing = true; let release = (): void => undefined, wire: unknown;
			try {
				release = c.reserve(0); const signal = signalOf(options), body = canonicalMediaContentBlob(input);
				wire = await captureDesktopPhotoCloneCurrentV1(blobMetadata(input, metadata, body));
				release(); release = c.reserve(measureDesktopPhotoCloneCurrentV1(wire));
				const expectedSha256 = await digestDesktopPhotoBlobCurrentV1(body, signal ?? c.signal); release();
				return await uploadDesktopPhotoBlobCurrentV1(c, { operation: 'asset-begin', assetId, metadata: wire, expectedBytes: body.size, expectedSha256 }, body, signal, metadataReply);
			} finally { retireDesktopPhotoCloneCurrentV1(wire); release(); metadataPreparing = false; }
		}),
		beginAssetWrite: (assetId, metadata, options) => c.own(async () => {
			if (metadataPreparing) throw new RangeError('Desktop metadata preparation capacity is occupied.');
			metadataPreparing = true; let release = (): void => undefined, wire: unknown;
			try {
				release = c.reserve(0); const row = record(options, 'native stream options', ['expectedBytes', 'expectedSha256', 'signal'], ['expectedBytes', 'expectedSha256']);
				const expectedBytes = integer(field(row, 'expectedBytes'), 0, Number.MAX_SAFE_INTEGER, 'stream size'), expectedSha256 = digest(field(row, 'expectedSha256'));
				const signal = signalOf(Object.hasOwn(row, 'signal') ? { signal: field(row, 'signal') } : {});
				wire = await captureDesktopPhotoCloneCurrentV1(metadata);
				release(); release = c.reserve(measureDesktopPhotoCloneCurrentV1(wire)); release();
				return await openDesktopPhotoUploadCurrentV1(c, { operation: 'asset-begin', assetId, metadata: wire, expectedBytes, expectedSha256 }, expectedBytes, signal, metadataReply);
			} finally { retireDesktopPhotoCloneCurrentV1(wire); release(); metadataPreparing = false; }
		}),
		getAssetMetadata: assetId => c.send('upload', () => ({ operation: 'metadata', assetId }), value => value === null ? null : metadataReply(value)),
		deleteAsset: (assetId, options = {}) => c.own(() => c.send('upload', () => ({ operation: 'delete-asset', assetId }), empty, signalOf(options), false, true)),
		inspectCatalogOriginalBody: (binding, options = {}) => c.own(() => c.send('upload', () => ({ operation: 'inspect', binding: normalizeCatalogOriginalRepairBindingV1(binding) }), inspection, signalOf(options))),
		restoreCatalogOriginalBody: (binding, selected, options = {}) => c.own(async () => {
			const release = c.reserve(0), admitted = normalizeCatalogOriginalRepairBindingV1(binding), signal = signalOf(options), body = canonicalMediaContentBlob(selected);
			try { const expectedSha256 = await digestDesktopPhotoBlobCurrentV1(body, signal ?? c.signal); release();
				return await uploadDesktopPhotoBlobCurrentV1(c, { operation: 'repair-begin', binding: admitted, expectedBytes: body.size, expectedSha256 }, body, signal, value => {
					const row = record(value, 'exact repair receipt', ['assetId', 'sha256', 'size']); return Object.freeze({ assetId: string(field(row, 'assetId')), sha256: digest(field(row, 'sha256')), size: integer(field(row, 'size'), 0, Number.MAX_SAFE_INTEGER, 'repair size') }); });
			} finally { release(); }
		}),
		createBinaryDerivativeCache: value => { c.assert(); const profile = normalizeBinaryDerivativeCacheProfileV1(value); return Object.freeze<ReturnType<Media['createBinaryDerivativeCache']>>({
			load: (input, signal) => c.own(async () => {
				const identity = normalizeBinaryDerivativeCacheIdentityV1(input, profile), release = c.reserve(identity.byteLength); let h: ReturnType<typeof handle<'download'>> | undefined, cleaned = false, bytes: Uint8Array<ArrayBuffer> | undefined;
				let failed = false, primary: unknown, result: Awaited<ReturnType<ReturnType<Media['createBinaryDerivativeCache']>['load']>> = null;
				try {
					const receipt = await c.send('cache', () => ({ operation: 'load', profile, identity }), v => v, signal, false, true);
					if (receipt !== null) {
						const row = record(receipt, 'cache download', ['handle', 'identity', 'outputSha256', 'mimeType', 'byteLength']); h = handle(field(row, 'handle'), 'download');
						const actual = normalizeBinaryDerivativeCacheIdentityV1(field(row, 'identity'), profile); if (JSON.stringify(actual) !== JSON.stringify(identity)) throw new TypeError('Native cache identity mismatch.');
						const outputSha256 = digest(field(row, 'outputSha256')), mimeType = desktopPhotoMimeCurrentV1(field(row, 'mimeType'));
						bytes = await readDesktopPhotoDownloadCurrentV1(c, 'cache', receipt, identity.byteLength, outputSha256, signal);
						const body = new Blob([bytes], { type: mimeType }); c.assert(); if (signal) signal.throwIfAborted(); result = Object.freeze({ identity: actual, outputSha256, body });
					}
				} catch (error) { failed = true; primary = error; }
				finally { if (bytes) wipe(bytes); }
				try { if (h) await c.send('cache', () => ({ operation: 'close-download', handle: h }), empty, undefined, true, true); cleaned = true; }
				catch (cleanup) { c.notice(cleanup); if (failed && !Object.is(primary, cleanup)) throw new AggregateError([primary, cleanup], 'Cache materialization and retirement failed.', { cause: cleanup }); throw cleanup; }
				finally { if (cleaned) release(); }
				if (failed) throw primary; return result;
			}),
			store: (input, source, expectedOutputSha256, signal) => c.own(async () => {
				const identity = normalizeBinaryDerivativeCacheIdentityV1(input, profile), body = canonicalMediaContentBlob(source), release = c.reserve(body.size);
				try { if (body.size !== identity.byteLength) throw new TypeError('Cache body size differs from its identity.'); digest(expectedOutputSha256); release();
					return await uploadDesktopPhotoBlobCurrentV1(c, { operation: 'cache-begin', profile, identity, expectedOutputSha256, mimeType: body.type }, body, signal, readDesktopPhotoCacheStoreCurrentV1);
				} finally { release(); }
			}),
			trim: signal => c.send('cache', () => ({ operation: 'trim', profile }), readDesktopPhotoCacheTrimCurrentV1, signal, false, true),
		}); },
	});
}
async function metadataReply(value: unknown): Promise<Record<string, unknown>> {
	try { const result = await readDesktopPhotoCloneCurrentV1(value); if (result === null || typeof result !== 'object' || Array.isArray(result)) throw new TypeError('Native metadata record required.'); return result as Record<string, unknown>; }
	finally { retireDesktopPhotoCloneCurrentV1(value); }
}
function blobMetadata(input: Blob, value: unknown, body: Blob): Record<string, unknown> {
	const snapshot: unknown = CLONE(value); const metadata: Record<string, unknown> = snapshot !== null && typeof snapshot === 'object' ? { ...snapshot } : {};
	let name = '', lastModified = 0; if (NAME && MODIFIED) { try { name = Reflect.apply(NAME, input, []) as string; lastModified = Reflect.apply(MODIFIED, input, []) as number; } catch { /* Plain native Blob has no File facts. */ } }
	if (!metadata.name) metadata.name = name; if (!metadata.mimeType) metadata.mimeType = body.type; if (metadata.lastModified === undefined) metadata.lastModified = lastModified; return metadata;
}
function cursor(value: unknown): string | null { return value === null ? null : string(value); }
function string(value: unknown): string { if (typeof value !== 'string' || value.length > 4096) throw new TypeError('Bounded native scalar required.'); return value; }
function inspection(value: unknown) {
	const row = record(value, 'Original inspection', ['status', 'reason'], ['status']), status = field(row, 'status');
	if (status === 'present') { record(value, 'present Original', ['status']); return Object.freeze({ status: 'present' as const }); }
	if (status === 'corrupt') return Object.freeze({ status: 'corrupt' as const, reason: oneOf(field(row, 'reason'), ['size', 'digest'], 'corruption reason') });
	if (status === 'missing') return Object.freeze({ status: 'missing' as const, reason: oneOf(field(row, 'reason'), ['media-row', 'directory', 'file', 'chunk', 'inline-blob'], 'missing reason') });
	throw new TypeError('Unknown Original inspection status.');
}
