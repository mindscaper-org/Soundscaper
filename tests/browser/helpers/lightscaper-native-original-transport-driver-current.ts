/* SPDX-License-Identifier: AGPL-3.0-only */

import { DesktopPhotoOriginalSourceCurrentV1 } from '../../../src/lightscaper/desktop-photo-original-source-current-v1.ts';
import { withPhotoLibraryOriginalCurrentV1, type PhotoLibraryOriginalRequestCurrentV1, type PhotoLibraryOriginalSourceCurrentV1 } from '../../../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { withPhotoOriginalFrameCurrentV1 } from '../../../src/lightscaper/preview/photo-original-frame-current-v1.ts';
import { capturePhotoOriginalBindingCurrentV1 } from '../../../src/lightscaper/preview/photo-original-binding-current-v1.ts';
import { digestMediaContent } from '../../../src/common/editor/storage/media-content-digest.ts';
import { withDecodedRawOriginalV1, type LibRawRuntimeOptionsV1, type LibRawWorkerPortV1 } from '../../../src/common/editor/raw/libraw-runtime-v1.ts';
import { compilePinnedLibRawModuleV1 } from '../../../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import type { PixelFrameV1 } from '../../../src/common/editor/imaging/pixel-frame-contract-v1.ts';

export interface OriginalTransportBrowserFactsCurrentV1 {
	readonly file: Readonly<{ genuine: boolean; name: string; size: number; sha256: string }>;
	readonly descriptor: PixelFrameV1['descriptor']; readonly orientation: number; readonly runtimeVersion: string;
	readonly nativeWords: boolean; readonly alphaOpaque: boolean; readonly firstPixels: readonly number[];
	readonly low: readonly number[]; readonly high: readonly number[]; readonly blue: readonly number[]; readonly red: readonly number[];
	readonly workers: Readonly<{ created: number; terminated: number; activeAtConsumer: number }>;
	readonly wiped: boolean;
}
interface State {
	readonly source: DesktopPhotoOriginalSourceCurrentV1; readonly release: () => void;
	work: Promise<void>; closing?: Promise<void>; closed: boolean; settled: boolean; entered: boolean;
	failed: boolean; failure?: unknown; facts?: Omit<OriginalTransportBrowserFactsCurrentV1, 'wiped'>;
	pixels?: PixelFrameV1['pixels'];
}
let current: State | undefined;
const FILE_NAME = Object.getOwnPropertyDescriptor(File.prototype, 'name')!.get!;
const BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;

/** Only the explicit test transport seam crosses into Node. No browser native
 * object, decoder, worker message, File or pixel-producing API is replaced. */
function invoke(value: unknown): Promise<unknown> {
	const binding: unknown = Reflect.get(globalThis, '__lightscaperOriginalTransportCurrentV1');
	if (typeof binding !== 'function') throw new Error('Actual native qualification binding is absent.');
	return Reflect.apply(binding, globalThis, [value]) as Promise<unknown>;
}

export function beginNativeOriginalBrowserCurrentV1(request: Readonly<PhotoLibraryOriginalRequestCurrentV1>,
	kind: 'raster' | 'raw', paths: Readonly<{ worker: string; wasm: string }>): void {
	if (current) throw new Error('A browser Original qualification already owns this page.');
	const source = new DesktopPhotoOriginalSourceCurrentV1({
		open: value => invoke({ operation: 'open', request: value }),
		async read(ticket, offset, length) {
			const result = await invoke({ operation: 'read', ticket, offset, length });
			if (!result || typeof result !== 'object') throw new Error('Native qualification read returned no closed response.');
			const fields = result as Readonly<Record<string, unknown>>;
			if (Object.keys(fields).sort().join(',') !== 'base64,length,offset' || fields.offset !== offset || fields.length !== length
				|| typeof fields.base64 !== 'string' || fields.base64.length > Math.ceil(length / 3) * 4) throw new Error('Native qualification read differs from its bounded interval.');
			const text = atob(fields.base64); if (text.length !== length) throw new Error('Native qualification bytes differ from exact read length.');
			const bytes = new Uint8Array(length); for (let index = 0; index < length; index++) bytes[index] = text.charCodeAt(index); return bytes;
		},
		async close(ticket) { if (await invoke({ operation: 'close', ticket }) !== true) throw new Error('Native ticket retirement did not acknowledge.'); },
	});
	let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
	const state: State = { source, release, work: Promise.resolve(), entered: false, settled: false, closed: false, failed: false }; current = state;
	state.work = (async () => {
		const workers = { created: 0, terminated: 0 }, active = new Set<Worker>();
		let options: Readonly<LibRawRuntimeOptionsV1> = {};
		if (kind === 'raw') {
			const response = await fetch(paths.wasm); if (!response.ok) throw new Error('Pinned LibRaw bytes were not served.');
			const module = await compilePinnedLibRawModuleV1(new Uint8Array(await response.arrayBuffer()));
			options = { loadModule: () => Promise.resolve(module), createWorker() {
				const worker = new Worker(paths.worker, { type: 'module', name: 'lightscaper-native-original-proof' });
				const post = worker.postMessage, add = worker.addEventListener, remove = worker.removeEventListener, terminate = worker.terminate;
				workers.created++; active.add(worker);
				const port: LibRawWorkerPortV1 = {
					postMessage: (message, transfer) => { Reflect.apply(post, worker, [message, transfer]); },
					addEventListener: (type, listener) => { Reflect.apply(add, worker, [type, listener]); },
					removeEventListener: (type, listener) => { Reflect.apply(remove, worker, [type, listener]); },
					terminate: () => { Reflect.apply(terminate, worker, []); active.delete(worker); workers.terminated++; },
				}; return port;
			} };
		}
		try {
			let file: OriginalTransportBrowserFactsCurrentV1['file'] | undefined;
			// Observe the actual production lease while forwarding every request
			// unchanged. Even failed evidence capture joins its native lease.
			const scoped: PhotoLibraryOriginalSourceCurrentV1 = { async acquire(value, options) {
				const lease = await source.acquire(value, options);
				try {
					file = { genuine: lease.body instanceof File && typeof Reflect.apply(FILE_NAME, lease.body, []) === 'string',
						name: Reflect.apply(FILE_NAME, lease.body, []) as string, size: Reflect.apply(BLOB_SIZE, lease.body, []) as number,
						sha256: await digestMediaContent(lease.body, { chunkBytes: 1024 * 1024 }) }; return lease;
				} catch (primary) {
					try { await lease.close(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Native File observation/retirement failed.', { cause: cleanup }); }
					throw primary;
				}
			} };
			const original = request.original;
			const binding = capturePhotoOriginalBindingCurrentV1({ catalogId: request.catalogId, photoId: request.photoId,
				originalId: original.id, storageKey: original.storageKey, contentSha256: original.contentSha256,
				byteLength: original.byteLength, width: original.width, height: original.height }, original);
			const raw: typeof withDecodedRawOriginalV1 = (value, consume) => withDecodedRawOriginalV1(value, consume, options);
			await withPhotoLibraryOriginalCurrentV1(scoped, request, body => withPhotoOriginalFrameCurrentV1({ binding, body }, async (frame, provenance) => {
				if (!file) throw new Error('Native File evidence was not captured.');
				state.pixels = frame.pixels;
				const pixel = (x: number, y: number) => Array.from(frame.pixels.subarray((y * frame.descriptor.width + x) * 4, (y * frame.descriptor.width + x) * 4 + 3));
				state.facts = { file, descriptor: frame.descriptor, orientation: provenance.orientation, runtimeVersion: provenance.runtimeVersion,
					nativeWords: frame.pixels instanceof Uint16Array, alphaOpaque: frame.pixels.every((value, index) => index % 4 !== 3 || value === (kind === 'raw' ? 65535 : 255)),
					firstPixels: Array.from(frame.pixels.subarray(0, 16)), low: pixel(kind === 'raw' ? 8 : 0, kind === 'raw' ? 8 : 0),
					high: pixel(kind === 'raw' ? 24 : 1, kind === 'raw' ? 8 : 0), blue: pixel(kind === 'raw' ? 8 : 0, kind === 'raw' ? 24 : 1),
					red: pixel(kind === 'raw' ? 24 : 1, kind === 'raw' ? 24 : 1), workers: { ...workers, activeAtConsumer: active.size } };
				state.entered = true; await held;
			}, kind === 'raw' ? { withRawFrame: raw } : {}));
		} finally { for (const worker of active) worker.terminate(); active.clear(); }
	})().then(() => { state.settled = true; }, (error: unknown) => { state.failed = true; state.failure = error; state.settled = true; });
}

export function requestNativeOriginalBrowserCloseCurrentV1(): void {
	if (!current) throw new Error('No active browser Original qualification.');
	const state = current;
	state.closing ??= state.source.close().then(() => { state.closed = true; }); void state.closing.catch(() => undefined);
}
export async function nativeOriginalBrowserStatusCurrentV1() {
	const state = current;
	return { entered: state?.entered ?? false, settled: state?.settled ?? false, closed: state?.closed ?? false,
		stages: await stageCount(), failed: state?.failed ?? false };
}
export async function finishNativeOriginalBrowserCurrentV1(): Promise<Readonly<OriginalTransportBrowserFactsCurrentV1>> {
	if (!current) throw new Error('No active browser Original qualification.');
	const state = current; state.release(); await state.work;
	const failures: unknown[] = state.failed ? [state.failure] : [];
	try { await (state.closing ?? state.source.close()); } catch (error) { failures.push(error); }
	if (failures.length) throw new AggregateError(failures, 'Actual Original browser consumer/retirement failed.');
	if (!state.facts || !state.pixels) throw new Error('Actual Original decoder produced no consumer evidence.');
	return { ...state.facts, wiped: state.pixels.every(value => value === 0) };
}
async function stageCount(): Promise<number> {
	const root = await navigator.storage.getDirectory(); let directory: FileSystemDirectoryHandle;
	try { directory = await root.getDirectoryHandle('lightscaper-desktop-original-staging-v1'); }
	catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return 0; throw error; }
	let count = 0;
	for await (const _entry of directory as FileSystemDirectoryHandle & AsyncIterable<readonly [string, FileSystemHandle]>) count++;
	return count;
}
