/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DesktopPhotoLibrarySessionStorageCurrentV1 as Storage } from './desktop-photo-library-session-storage-current-v1.ts';
import { DesktopPhotoSessionClientCallsCurrentV1 as Calls, desktopPhotoSignalCurrentV1 as signalOf, desktopPhotoVoidCurrentV1 as empty } from './desktop-photo-library-session-client-calls-current-v1.ts';
import { normalizeVideoCubeLutReferenceV1 } from '../common/imaging/cube-lut-reference-contract.ts';
import { normalizeBrushMaskResourceReferenceV1 } from '../common/editor/imaging/brush-mask-resource-v1.ts';
import { canonicalMediaContentBlob } from '../common/media/content-digest.ts';
import { readDesktopPhotoLibrarySessionHandleCurrentV1 as handle } from './desktop-photo-library-session-protocol-current-v1.ts';
import { copyDesktopPhotoBytesCurrentV1 as copy, desktopPhotoDigestCurrentV1, digestDesktopPhotoBlobCurrentV1,
	uploadDesktopPhotoBlobCurrentV1, readDesktopPhotoDownloadCurrentV1, wipeDesktopPhotoBytesCurrentV1 as wipe } from './desktop-photo-library-session-transfer-client-current-v1.ts';
import { boolean, field, record } from './catalog/value-validation.ts';

type Family = 'lut' | 'brush';
export function createDesktopPhotoSessionResourcesCurrentV1(c: Calls): Storage['components']['resources'] {
	function reference(family: Family, value: unknown) { return family === 'lut' ? normalizeVideoCubeLutReferenceV1(value) : brushReference(value); }
	function verify(family: Family, operation: 'verify-photo' | 'verify-preset' | 'verify-references', value: unknown, signal?: AbortSignal): Promise<void> {
		return c.send('resource', () => ({ operation, family, [operation === 'verify-photo' ? 'photo' : operation === 'verify-preset' ? 'preset' : 'references']: value }), empty, signal);
	}
	function withBytes<Value>(family: Family, value: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Value | Promise<Value>, options: unknown = {}): Promise<Value> {
		return c.own(async () => {
			const signal = signalOf(options), ref = reference(family, value); if (typeof consume !== 'function') throw new TypeError('Resource consumer required.');
			const release = c.reserve(ref.byteLength); let h: ReturnType<typeof handle<'resource'>> | undefined, bytes: Uint8Array<ArrayBuffer> | undefined;
			let result!: Value, failed = false, primary: unknown, cleaned = false;
			try {
				const receipt = await c.send('resource', () => ({ operation: 'open', family, reference: ref }), v => v, signal, false, true);
				const row = record(receipt, 'resource receipt', ['handle', 'byteLength']); h = handle(field(row, 'handle'), 'resource');
				bytes = await readDesktopPhotoDownloadCurrentV1(c, 'resource', receipt, ref.byteLength, ref.sha256, signal);
				c.assert(); if (signal) signal.throwIfAborted(); result = await consume(bytes); c.assert(); if (signal) signal.throwIfAborted();
			} catch (error) { failed = true; primary = error; }
			finally { if (bytes) { try { wipe(bytes); } catch (cleanup) { c.notice(cleanup); primary = failed && !Object.is(primary, cleanup) ? new AggregateError([primary, cleanup], 'Resource consumer and byte retirement failed.') : cleanup; failed = true; } } }
			try { if (h) await c.send('resource', () => ({ operation: 'close', handle: h }), empty, undefined, true, true); cleaned = true; }
			catch (cleanup) { c.notice(cleanup); if (failed && !Object.is(primary, cleanup)) throw new AggregateError([primary, cleanup], 'Resource consumer and native retirement failed.', { cause: cleanup }); throw cleanup; }
			finally { if (cleaned) release(); }
			if (failed) throw primary; return result;
		});
	}
	function put(family: Family, value: unknown, input: unknown, options: unknown = {}) {
		return c.own(async () => {
			const signal = signalOf(options), ref = reference(family, value), release = c.reserve(ref.byteLength);
			let bytes: Uint8Array<ArrayBuffer> | undefined;
			try {
				bytes = copy(input, family === 'lut' ? 16_777_216 : 1_048_592);
				if (bytes.byteLength !== ref.byteLength) throw new TypeError('Resource bytes differ from declared length.');
				const body = new Blob([bytes]); release();
				return await uploadDesktopPhotoBlobCurrentV1(c, { operation: 'resource-begin', family, reference: ref }, body, signal, v => receipt(family, v));
			} finally { if (bytes) wipe(bytes); release(); }
		});
	}
	const lut: Awaited<ReturnType<Storage['components']['resources']['cubeLutResources']>> = Object.freeze<Awaited<ReturnType<Storage['components']['resources']['cubeLutResources']>>>({
		source: Object.freeze<Awaited<ReturnType<Storage['components']['resources']['cubeLutResources']>>['source']>({ withBytes: (value, consume, options) => withBytes('lut', value, consume, options) }),
		put: async (value, bytes, options) => { const result = await put('lut', value, bytes, options); return { ...result, reference: normalizeVideoCubeLutReferenceV1(result.reference) }; },
		importFile: (file, options = {}) => c.own(async () => {
			const signal = signalOf(options); const body = canonicalMediaContentBlob(file); if (body.size < 1 || body.size > 16_777_216) throw new RangeError('LUT file bound exceeded.');
			const release = c.reserve(body.size);
			try { const expectedSha256 = await digestDesktopPhotoBlobCurrentV1(body, signal ?? c.signal); release();
				const result = await uploadDesktopPhotoBlobCurrentV1(c, { operation: 'resource-file-begin', family: 'lut', name: '', mimeType: body.type, expectedBytes: body.size, expectedSha256 }, body, signal, v => receipt('lut', v));
				return { ...result, reference: normalizeVideoCubeLutReferenceV1(result.reference) };
			} finally { release(); }
		}),
		verifyPhoto: (value, signal) => verify('lut', 'verify-photo', value, signal), verifyPreset: (value, signal) => verify('lut', 'verify-preset', value, signal),
		verifyReferencesV1: (value, signal) => verify('lut', 'verify-references', value, signal),
	});
	const brush: Awaited<ReturnType<Storage['components']['resources']['maskRasterResources']>> = Object.freeze<Awaited<ReturnType<Storage['components']['resources']['maskRasterResources']>>>({
		source: Object.freeze<Awaited<ReturnType<Storage['components']['resources']['maskRasterResources']>>['source']>({ withBytes: (value, consume, options) => withBytes('brush', value, consume, options) }),
		put: async (value, bytes, options) => { const result = await put('brush', value, bytes, options); return { ...result, reference: brushReference(result.reference) }; },
		verifyPhoto: (value, signal) => verify('brush', 'verify-photo', value, signal), verifyPreset: (value, signal) => verify('brush', 'verify-preset', value, signal),
		verifyReferencesV1: (value, signal) => verify('brush', 'verify-references', value, signal),
	});
	return Object.freeze({ cubeLutResources: () => c.own(() => lut), maskRasterResources: () => c.own(() => brush) });
	function receipt(family: Family, value: unknown) { const row = record(value, 'resource publication', ['reference', 'created']); const ref = reference(family, field(row, 'reference')); desktopPhotoDigestCurrentV1(ref.sha256); return Object.freeze({ reference: ref, created: boolean(field(row, 'created'), 'resource creation') }); }
}

function brushReference(value: unknown) {
	if (typeof value === 'string') return normalizeBrushMaskResourceReferenceV1(value);
	const row = record(value, 'brush reference', ['storageKey', 'sha256', 'width', 'height', 'byteLength']);
	const ref = normalizeBrushMaskResourceReferenceV1(field(row, 'storageKey'));
	for (const key of ['storageKey', 'sha256', 'width', 'height', 'byteLength'] as const) if (field(row, key) !== ref[key]) throw new TypeError('Brush reference differs from its key.');
	return ref;
}
