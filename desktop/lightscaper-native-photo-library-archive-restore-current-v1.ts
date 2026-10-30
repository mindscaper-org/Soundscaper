/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryRestoreReceiptV1 } from '../src/common/editor/photo-library-restore-port-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/foundation/closed-domain-value.ts';
import { aggregateScapeErrors } from '../src/common/scape/abort.ts';
import type { ScapeProjectInput, ScapeProjectInputReaderFactories } from '../src/common/editor/scape-project-input.ts';
import { importPhotoCatalogArchiveV8 } from '../src/lightscaper/archive/catalog-archive-import-v8.ts';
import type { PhotoCatalogArchiveStageV8 } from '../src/lightscaper/archive/catalog-archive-import-kernel.ts';
import { captureLightscaperNativePhotoLibraryRestorePhotoCurrentV1 as capturePhoto } from './lightscaper-native-photo-library-restore-source-policy-current-v1.ts';
import { name } from '../src/lightscaper/catalog/value-validation.ts';
import { assertMediaRestoreSignalV1, mediaRestoreCancellationV1, forwardMediaRestoreSignalV1 } from '../src/lightscaper/storage/photo-media-restore-signal-v1.ts';
import type { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from './lightscaper-native-photo-library-scopes-current-v1.ts';
import { readLightscaperNativePhotoLibraryArchiveOwnerCurrentV1 as readOwner } from './lightscaper-native-photo-library-archive-owner-current-v1.ts';
import { createLightscaperNativeCatalogRestoreStageCurrentV1 as createCatalog } from './lightscaper-native-catalog-restore-stage-current-v1.ts';
import { createLightscaperNativePhotoMediaRestoreStageCurrentV1 as createMedia } from './lightscaper-native-photo-media-restore-stage-current-v1.ts';
import { createLightscaperNativePhotoLibraryRestoreReadyCurrentV1 as createReady } from './lightscaper-native-photo-library-restore-ready-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { captureLightscaperNativePhotoLibraryArchiveReadersCurrentV1 as captureReaders } from './lightscaper-native-photo-library-archive-readers-current-v1.ts';
import { ownLightscaperNativePhotoLibraryArchiveInputCurrentV1 as ownInput } from './lightscaper-native-photo-library-archive-input-current-v1.ts';

export interface LightscaperNativePhotoLibraryArchiveRestoreOptionsCurrentV1 {
	readonly name: string; readonly signal?: AbortSignal; readonly readerFactories?: ScapeProjectInputReaderFactories;
}
const active = new WeakSet<object>();
const NativeController = AbortController, ABORT = AbortController.prototype.abort;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
const REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

/** Main-private composition. Scopes.restoreArchive owns the complete input job
 * across shutdown; this entrypoint stages exclusively in a fresh generation.
 * The shared codec closes and joins its actual reader before calling publish. */
export async function restoreLightscaperNativePhotoLibraryArchiveCurrentV1(scopes: Scopes, input: ScapeProjectInput,
	options: LightscaperNativePhotoLibraryArchiveRestoreOptionsCurrentV1): Promise<Readonly<PhotoLibraryRestoreReceiptV1>> {
	if (active.has(scopes)) throw new Error('A native archive restore already owns this manager.'); active.add(scopes);
	let candidate: Awaited<ReturnType<Scopes['beginRestore']>> | null = null, cleaning: Promise<void> | null = null;
	let inputOwner: ReturnType<typeof ownInput> | undefined;
	let stop: ReturnType<typeof forwardMediaRestoreSignalV1> | undefined, forward: (() => void) | undefined;
	let acknowledged: Readonly<PhotoLibraryRestoreReceiptV1> | null = null;
	let codecFailure: Readonly<{ primary: unknown; boundary: Error }> | null = null;
	const codec = new NativeController(), codecAbort = new DOMException('Native library restore was cancelled.', 'AbortError');
	const cleanupErrors: unknown[] = [];
	const throughCodec = async <Value>(run: () => Promise<Value>): Promise<Value> => {
		try { return await run(); } catch (primary) {
			const boundary = stop && mediaRestoreCancellationV1(primary, stop.signal) ? codecAbort : new Error('Native restore stage failed.', { cause: primary });
			codecFailure ??= Object.freeze({ primary, boundary }); throw boundary;
		}
	};
	const cleanup = (): Promise<void> => {
		cleaning ??= Promise.resolve().then(async () => {
			if (!candidate) return;
			try { await candidate.close(); } catch (error) { cleanupErrors.push(error); return; }
			try { candidate.retireRole('unpublished'); } catch (error) { cleanupErrors.push(error); }
		}); return cleaning;
	};
	let failed = false, primary: unknown;
	try {
		const owner = readOwner(scopes);
		const value = record(options, 'native library archive restore', ['name', 'signal', 'readerFactories'], ['name']);
		const catalogName = name(field(value, 'name', 'native library archive restore'), 'catalog name');
		const signal = Object.hasOwn(value, 'signal') ? field(value, 'signal', 'native library archive restore') : undefined;
		if (signal !== undefined) assertMediaRestoreSignalV1(signal);
		stop = forwardMediaRestoreSignalV1(signal); forward = () => { Reflect.apply(ABORT, codec, [codecAbort]); };
		Reflect.apply(ADD, stop.signal, ['abort', forward, { once: true }]); check(stop.signal);
		const readers = captureReaders(Object.hasOwn(value, 'readerFactories') ? field(value, 'readerFactories', 'native library archive restore') : undefined);
		inputOwner = ownInput(input); const source = inputOwner.input;
		const readerFactories = inputOwner.blob === null ? readers : readers?.blob === undefined ? undefined : {
			byteSource: (_source, signal) => readers.blob!(inputOwner!.blob!, signal),
		} satisfies ScapeProjectInputReaderFactories;
		const selected = await owner.openSelected({ name: catalogName, signal: stop.signal });
		check(stop.signal);
		await importPhotoCatalogArchiveV8(source, (root, savedState, presets, lutResources, maskRasters) => throughCodec(async () => {
			check(stop!.signal);
			candidate = await owner.beginRestore(root.id, { signal: stop!.signal, expectedSelectionToken: selected.selectionToken });
			const catalog = await createCatalog(candidate.catalogClaim, { root, savedState, signal: stop!.signal });
			const media = await createMedia(candidate.mediaClaim, { root, developPresets: presets === null ? null : {
				rowSchemaVersion: presets.rowSchemaVersion, revision: presets.revision, presetCount: presets.presetCount }, lutResources, maskRasters, signal: stop!.signal });
			return Object.freeze<PhotoCatalogArchiveStageV8>({
				writePhoto: (value, original) => throughCodec(async () => {
					const { photo } = capturePhoto(value); await media.writeOriginal(photo, original); check(stop!.signal); await catalog.writePhoto(photo);
				}),
				writeStack: value => throughCodec(async () => { await catalog.writeStack(value); }),
				writeSavedCollection: value => throughCodec(async () => { await catalog.writeSavedCollection(value); }),
				writeDevelopPresets: value => throughCodec(async () => { await media.writeDevelopPresets(value); }),
				writeLut: (reference, bytes) => throughCodec(async () => { await media.writeLut(reference, bytes); }),
				writeMaskRaster: (reference, bytes) => throughCodec(async () => { await media.writeMaskRaster(reference, bytes); }),
				publish: () => throughCodec(async () => {
					check(stop!.signal); const catalogReceipt = await catalog.finish(), mediaReceipt = await media.finish(catalog);
					await candidate!.close(); check(stop!.signal);
					const ready = createReady(candidate, catalogReceipt, mediaReceipt);
					const result = await owner.publishRestoreReady(ready, { signal: stop!.signal });
					const receipt = result.receipt;
					acknowledged = Object.freeze({ catalogId: root.id, catalogName: root.name, photoCount: receipt.photoCount, stackCount: receipt.stackCount,
						savedCollectionCount: receipt.savedCollectionCount, originalCount: receipt.originalCount, originalByteLength: receipt.originalByteLength,
						notices: Object.freeze(result.status === 'reconciled' ? ['publication-reconciled' as const] : []) });
				}),
				rollback: cleanup,
			});
		}), { signal: codec.signal, readerFactories });
	} catch (error) {
		failed = true; const captured = codecFailure as Readonly<{ primary: unknown; boundary: Error }> | null;
		primary = captured ? captured.primary : error === codecAbort && stop ? Reflect.apply(REASON, stop.signal, []) as unknown : error;
		if (captured && error !== captured.boundary) cleanupErrors.push(error);
	} finally {
		await cleanup();
		try { await inputOwner?.close(); } catch (error) { cleanupErrors.push(error); }
		try { if (stop && forward) Reflect.apply(REMOVE, stop.signal, ['abort', forward]); stop?.detach(); } catch (error) { cleanupErrors.push(error); }
		active.delete(scopes);
	}
	if (acknowledged !== null) {
		const result = acknowledged as PhotoLibraryRestoreReceiptV1;
		return cleanupErrors.length ? Object.freeze({ ...result, notices: Object.freeze([...result.notices, 'cleanup-failed' as const]) }) : result;
	}
	if (!failed) primary = new Error('Native archive restore finished without a publication acknowledgement.');
	throw aggregateScapeErrors(primary, cleanupErrors, 'Native library restore and cleanup failed.', { primaryIsAbort: stop !== undefined && mediaRestoreCancellationV1(primary, stop.signal) });
}
