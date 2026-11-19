/* SPDX-License-Identifier: AGPL-3.0-only */

import { DesktopPhotoOriginalSourceCurrentV1 } from '../../../src/lightscaper/desktop-photo-original-source-current-v1.ts';
import { withPhotoLibraryOriginalGroupCurrentV1 } from '../../../src/lightscaper/controller/photo-library-original-group-current-v1.ts';
import type { PhotoLibraryOriginalSourceCurrentV1 as Source, PhotoLibraryOriginalRequestCurrentV1 as Request } from '../../../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { withPhotoOriginalFrameCurrentV1 } from '../../../src/lightscaper/preview/photo-original-frame-current-v1.ts';
import { digestMediaContent } from '../../../src/common/media/content-digest.ts';
import type { PixelFrameV1 } from '../../../src/common/editor/imaging/pixel-frame-contract-v1.ts';

interface State {
	readonly source: DesktopPhotoOriginalSourceCurrentV1; readonly release: () => void;
	work: Promise<void>; closing?: Promise<void>; entered: boolean; settled: boolean; closed: boolean;
	failed: boolean; failure?: unknown; files: Array<Readonly<{ genuine: boolean; size: number; sha256: string }>>;
	readonly pixels: PixelFrameV1['pixels'][]; readonly values: number[][]; uniqueFiles: number;
}
let current: State | undefined;
function invoke(value: unknown): Promise<unknown> {
	const binding: unknown = Reflect.get(globalThis, '__lightscaperOriginalTransportCurrentV1');
	if (typeof binding !== 'function') throw new Error('Actual native qualification binding is absent.');
	return Reflect.apply(binding, globalThis, [value]) as Promise<unknown>;
}
async function read(group: Readonly<{ id: string }>, index: number, offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
	const raw = await invoke({ operation: 'readGroup', group, index, offset, length });
	if (!raw || typeof raw !== 'object') throw new Error('Native group returned no range receipt.');
	const value = raw as Readonly<Record<string, unknown>>;
	if (Object.keys(value).sort().join(',') !== 'base64,index,length,offset' || value.index !== index || value.offset !== offset || value.length !== length
		|| typeof value.base64 !== 'string' || value.base64.length > Math.ceil(length / 3) * 4) throw new Error('Native group range receipt differs.');
	const text = atob(value.base64); if (text.length !== length) throw new Error('Native group range length differs.');
	const bytes = new Uint8Array(length); for (let at = 0; at < length; at++) bytes[at] = text.charCodeAt(at); return bytes;
}
export function beginOriginalGroupBrowserCurrentV1(requests: readonly Readonly<Request>[]): void {
	if (current) throw new Error('This page already owns a group qualification.');
	const source = new DesktopPhotoOriginalSourceCurrentV1({
		open: async () => { throw new Error('No per-file prefix may open.'); }, read: async () => { throw new Error('No per-file prefix may read.'); },
		close: async () => { throw new Error('No per-file prefix may close.'); },
		openGroup: selected => invoke({ operation: 'openGroup', requests: selected }), readGroup: read,
		async closeGroup(group) { if (await invoke({ operation: 'closeGroup', group }) !== true) throw new Error('Native group retirement did not acknowledge.'); },
	});
	const stop = new AbortController(); let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
	const state: State = { source, release, work: Promise.resolve(), entered: false, settled: false, closed: false, failed: false,
		files: [], pixels: [], values: [], uniqueFiles: 0 }; current = state;
	// This deadline owns cancellation and the held painter receipt. It never
	// substitutes for source/group/frame retirement, which finish must join.
	const deadline = setTimeout(() => { release(); stop.abort(new Error('Native group browser work exceeded its deadline.')); requestOriginalGroupBrowserCloseCurrentV1(); }, 15_000);
	const scoped: Source = { acquire: source.acquire, async acquireGroup(selected, options) {
		if (!source.acquireGroup) throw new Error('Actual Desktop source lacks group admission.');
		const lease = await source.acquireGroup(selected, options);
		try {
			state.uniqueFiles = new Set(lease.bodies).size;
			for (const body of lease.bodies) state.files.push({ genuine: body instanceof File, size: body.size,
				sha256: await digestMediaContent(body, { signal: options?.signal, chunkBytes: 1024 * 1024 }) }); return lease;
		} catch (primary) {
			try { await lease.close(); } catch (cleanup) { throw new AggregateError([primary, cleanup], 'Group File observation and retirement failed.', { cause: cleanup }); } throw primary;
		}
	} };
	state.work = withPhotoLibraryOriginalGroupCurrentV1(scoped, requests, async bodies => {
		const render = async (index: number): Promise<void> => {
			if (index === requests.length) { state.entered = true; await held; return; }
			const request = requests[index]!, original = request.original;
			await withPhotoOriginalFrameCurrentV1({ body: bodies[index]!, signal: stop.signal, binding: {
				catalogId: request.catalogId, photoId: request.photoId, originalId: original.id, storageKey: original.storageKey,
				contentSha256: original.contentSha256, byteLength: original.byteLength, width: original.width, height: original.height,
			} }, async frame => { state.pixels.push(frame.pixels); state.values.push(Array.from(frame.pixels.subarray(0, 16))); await render(index + 1); });
		}; await render(0);
	}, stop.signal).then(() => { state.settled = true; }, (error: unknown) => { state.failed = true; state.failure = error; state.settled = true; }).finally(() => { clearTimeout(deadline); });
}
export function requestOriginalGroupBrowserCloseCurrentV1(): void {
	if (!current) throw new Error('No browser group is owned.'); const state = current;
	state.closing ??= state.source.close().then(() => { state.closed = true; }); void state.closing.catch(() => undefined);
}
export async function originalGroupBrowserStatusCurrentV1() {
	const state = current; let stages = 0;
	const root = await navigator.storage.getDirectory();
	try { const directory = await root.getDirectoryHandle('lightscaper-desktop-original-staging-v1');
		for await (const _entry of directory as FileSystemDirectoryHandle & AsyncIterable<readonly [string, FileSystemHandle]>) stages++;
	} catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
	return { entered: state?.entered ?? false, settled: state?.settled ?? false, closed: state?.closed ?? false, failed: state?.failed ?? false, stages };
}
export async function finishOriginalGroupBrowserCurrentV1() {
	if (!current) throw new Error('No browser group is owned.'); const state = current; state.release(); await state.work;
	const errors: unknown[] = state.failed ? [state.failure] : [];
	try { await (state.closing ?? state.source.close()); state.closed = true; } catch (error) { errors.push(error); }
	if (errors.length) throw new AggregateError(errors, 'Native group browser work or retirement failed.');
	return { files: state.files, uniqueFiles: state.uniqueFiles, pixels: state.values,
		wiped: state.pixels.length === 2 && state.pixels.every(pixels => pixels.every(value => value === 0)) };
}
