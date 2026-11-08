/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoLibrarySessionPortCurrentV1 as Session } from '../../common/editor/photo-library-session-port-current-v1.ts';
import type { PhotoLibraryDevelopSnapshotCurrentV1 as Snapshot } from '../../common/editor/photo-library-develop-port-current-v1.ts';
import type { DesktopPhotoOriginalStorageCurrentV1 as Storage } from '../desktop-photo-original-contract-current-v1.ts';
import { createBrowserFileSaveService } from '../../common/editor/browser-file-save-service.ts';
import { PhotoRasterExportCurrentV1 } from '../controller/photo-raster-export-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../photo-develop-render-runtime-current-v1.ts';
import { encodePhotoPngCurrentV1 } from '../controller/photo-png-export-encoder-current-v1.ts';
import { debugCheckCurrentV1 as check, debugCleanupFailureCurrentV1 as cleanupFailure, bindDebugMethodCurrentV1 as bind,
	type DebugOutputCurrentV1, type DebugOwnersCurrentV1 } from './photo-library-debug-soak-contract-current-v1.ts';
import { debugHashCurrentV1 as hash } from './photo-library-debug-bytes-current-v1.ts';
import { readDebugPngCurrentV1 } from './photo-library-debug-png-current-v1.ts';
import { createDebugOutputCurrentV1, type DebugOutputStageCurrentV1 } from './photo-library-debug-output-current-v1.ts';
const READ = Blob.prototype.arrayBuffer, SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
/** Actual export owner, actual private persistent writer/commit and independent Blob
 * readback. A failed close keeps its real Session/stage strongly quarantined. */
export async function exportDebugPhotoCurrentV1(session: Session, snapshot: Snapshot, iteration: number, signal: AbortSignal,
	storage: Storage | undefined, owners: DebugOwnersCurrentV1): Promise<Readonly<DebugOutputCurrentV1>> {
	check(signal);
	let stage: DebugOutputStageCurrentV1 | undefined, failed = false, primary: unknown, output: Readonly<DebugOutputCurrentV1> | undefined;
	const exporter = new PhotoRasterExportCurrentV1('png'), writers = new Set<object>(); owners.activeExports++;
	try {
		stage = await createDebugOutputCurrentV1(storage, signal); check(signal);
		const source = session.develop.original; if (!source) throw new Error('Complete Current Session Original decoder is unavailable.');
		const withFrame = bind(source.withFrame, source), withDerived = source.withDerivedFrame ? bind(source.withDerivedFrame, source) : undefined, develop = session.develop;
		const renderer = createPhotoDevelopRenderRuntimeCurrentV1({ source: session.cubeLuts.source, ...(session.maskRasterSource ? { maskSource: session.maskRasterSource } : {}) });
		const save = createBrowserFileSaveService(), prepare = bind(save.prepareSave, save), saveFile = bind(save.saveFile, save);
		const createWritable = bind(stage.createWritable, stage), getFile = bind(stage.read, stage);
		const target = { name: 'diagnostic.png', async createWritable() {
			const writer = await createWritable();
			writers.add(writer); const write = bind(writer.write, writer), close = bind(writer.close, writer), abort = bind(writer.abort, writer);
			return { async write(value: Blob | Uint8Array | Readonly<{ type: 'write'; position: number; data: Uint8Array }>) {
				if (!(value instanceof Uint8Array) || !(value.buffer instanceof ArrayBuffer)) throw new TypeError('Diagnostic PNG writes require owned byte chunks.');
				await write(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
			}, async close() { await close(); writers.delete(writer); }, async abort(reason?: unknown) { await abort(reason); writers.delete(writer); } };
		} };
		let encodedPixels: string | undefined;
		const receipt = await exporter.start({ photoId: snapshot.photoId, versionId: snapshot.versionId, expectedRevision: snapshot.revision,
			fileName: 'diagnostic.png', fileTypeDescription: 'Diagnostic lossless PNG', signal,
			output: { schemaVersion: 2, sizing: { kind: 'original' }, quality: 'nearest', metadataScope: 'strip', bitDepth: 8 },
			prepareSave: request => prepare({ ...request, target }), saveFile,
			execute: async (action, outerSignal) => { const active = outerSignal ? AbortSignal.any([signal, outerSignal]) : signal; check(active);
				await action({ signal: active, acquire: async () => develop, isCurrent: () => !active.aborted, refresh: () => session.readPage({ signal: active }) }); return 'completed'; },
			withOriginalFrame: withFrame,
			...(withDerived ? { withDerivedFrame: withDerived } : {}),
			loadRenderer: async () => renderer,
			encode: async (frame, options) => {
				if (frame.descriptor.sampleFormat !== 'unorm8' || frame.descriptor.width * frame.descriptor.height > 1_048_576 || !(frame.pixels.buffer instanceof ArrayBuffer)) throw new RangeError('Diagnostic export requires at most one megapixel of rendered RGBA8.');
				encodedPixels = hash(new Uint8Array(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength));
				return encodePhotoPngCurrentV1(frame, { ...options, maximumOutputBytes: 8 * 1024 * 1024 });
			},
		});
		if (receipt.status !== 'saved' || !encodedPixels) { check(signal); throw new Error('Diagnostic PNG did not commit its actual destination.'); }
		const body: unknown = await getFile(), size = Number(Reflect.apply(SIZE, body, []));
		if (size !== receipt.byteLength || size < 1 || size > 8 * 1024 * 1024) throw new RangeError('Diagnostic committed PNG length differs.');
		const bytes = new Uint8Array(await Reflect.apply(READ, body, []) as ArrayBuffer);
		try { check(signal); const readback = readDebugPngCurrentV1(bytes);
			if (readback.width !== receipt.width || readback.height !== receipt.height || readback.pixelsSha256 !== encodedPixels) throw new Error('Diagnostic committed PNG pixels differ from the actual encoder input.');
			output = Object.freeze({ iteration, photoId: snapshot.photoId, byteLength: bytes.length, sha256: hash(bytes), ...readback });
		} finally { bytes.fill(0); }
	} catch (error) { failed = true; primary = error; }
	const errors: unknown[] = [];
	try { await exporter.cancelAndJoin(); } catch (error) { errors.push(error); }
	if (writers.size) errors.push(new Error('Actual diagnostic writer has no successful close/abort receipt.'));
	if (!errors.length && stage) { try { await stage.remove(); } catch (error) { errors.push(error); } }
	if (errors.length) throw cleanupFailure(failed ? [primary] : [], new AggregateError(errors, 'Diagnostic PNG stage did not retire.'), { session, exporter, stage, writers });
	owners.activeExports--; if (failed) throw primary; if (!output) throw new Error('Diagnostic export has no readback.'); return output;
}
