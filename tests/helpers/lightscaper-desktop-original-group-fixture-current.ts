/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { DesktopPhotoOriginalSourceCurrentV1 } from '../../src/lightscaper/desktop-photo-original-source-current-v1.ts';
import type { DesktopPhotoOriginalDirectoryCurrentV1, DesktopPhotoOriginalStorageCurrentV1, DesktopPhotoOriginalTransportCurrentV1 } from '../../src/lightscaper/desktop-photo-original-contract-current-v1.ts';
import type { PhotoLibraryOriginalRequestCurrentV1 as Request } from '../../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { originalStageRequestCurrentV1 } from './lightscaper-desktop-original-stage-fixture-current.ts';
export { shaOriginalStageCurrentV1 as originalGroupShaCurrentV1 } from './lightscaper-desktop-original-stage-fixture-current.ts';

export interface OriginalGroupLeaseCurrentV1 { readonly bodies: readonly File[]; close(): Promise<void> }
export type OriginalGroupSourceCurrentV1 = DesktopPhotoOriginalSourceCurrentV1 & {
	acquireGroup(requests: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<OriginalGroupLeaseCurrentV1>>;
};
interface Gate { readonly promise: Promise<void>; release(): void; isReleased(): boolean }
/** Instrumented OPFS/transport ports return genuine native File snapshots.
 * This proves byte/capacity/lifetime contracts, not Chromium or native SQL. */
export function originalGroupFixtureCurrentV1(context: TestContext) {
	const events: string[] = [], ranges: Array<readonly [string, number, number]> = [], gates = new Set<Gate>();
	const waiters = new Map<string, Set<() => void>>(), stop = new AbortController();
	const sources = new Map<string, Uint8Array<ArrayBuffer>>(), groups = new Map<string, readonly Readonly<Request>[]>(), singles = new Map<string, Readonly<Request>>();
	const directories = new Set<string>(), parts = new Map<string, Uint8Array<ArrayBuffer>[]>();
	const leases = new Set<Readonly<{ close(): Promise<void> }>>(), operations = new Set<Promise<unknown>>();
	let sequence = 0, name = 0, reading = 0, maximumReading = 0, written = 0, opens = 0, groupOpens = 0, groupCloses = 0;
	const hooks = { open: async (): Promise<void> => undefined, groupOpen: async (): Promise<void> => undefined,
		read: async (_photoId: string): Promise<void> => undefined, write: async (): Promise<void> => undefined,
		writerClose: async (): Promise<void> => undefined, abort: async (): Promise<void> => undefined,
		remove: async (): Promise<void> => undefined, release: async (): Promise<void> => undefined,
		receipt: (value: unknown): unknown => value, file: (value: File): unknown => value };
	function event(value: string): void { events.push(value); for (const notify of waiters.get(value) ?? []) notify(); waiters.delete(value); }
	function gate(): Gate {
		let done!: () => void, released = false; const promise = new Promise<void>(resolve => { done = resolve; });
		const value = { promise, isReleased: () => released, release() { released = true; done(); gates.delete(value); } };
		gates.add(value); if (stop.signal.aborted) value.release(); return value;
	}
	function cancel(): void { for (const value of gates) value.release(); for (const listeners of waiters.values()) for (const notify of listeners) notify(); stop.abort(context.signal.reason); }
	context.signal.addEventListener('abort', cancel, { once: true }); if (context.signal.aborted) cancel();
	async function pull(request: Readonly<Request>, offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
		assert.ok(length >= 1 && length <= 1024 * 1024); reading++; maximumReading = Math.max(maximumReading, reading);
		ranges.push([request.photoId, offset, length]); event('read-start');
		try { await hooks.read(request.photoId); const bytes = sources.get(request.photoId); if (!bytes) throw new ReferenceError('Selected locator is missing.'); return bytes.slice(offset, offset + length); }
		finally { reading--; event('read-end'); }
	}
	const transport = {
		async open(request: Readonly<Request>) { opens++; event('open-start'); await hooks.open(); const id = (++sequence).toString(16).padStart(64, '0'); singles.set(id, request); return { id, original: request.original }; },
		read(ticket: Readonly<{ id: string }>, offset: number, length: number) { const request = singles.get(ticket.id); if (!request) throw new Error('Single ticket is closed.'); return pull(request, offset, length); },
		async close(ticket: Readonly<{ id: string }>) { event('single-close-start'); await hooks.release(); singles.delete(ticket.id); event('single-close-end'); },
		async openGroup(requests: readonly Readonly<Request>[]) {
			groupOpens++; event('group-open-start'); await hooks.groupOpen();
			const id = (++sequence).toString(16).padStart(64, '0'); groups.set(id, requests); event('group-open-end');
			return hooks.receipt({ id, originals: requests.map(request => request.original) });
		},
		readGroup(ticket: Readonly<{ id: string }>, index: number, offset: number, length: number) {
			const request = groups.get(ticket.id)?.[index]; if (!request) throw new Error('Group authority is closed or absent.'); return pull(request, offset, length);
		},
		async closeGroup(ticket: Readonly<{ id: string }>) { event('group-close-start'); await hooks.release(); groups.delete(ticket.id); groupCloses++; event('group-close-end'); },
	} satisfies DesktopPhotoOriginalTransportCurrentV1 & Record<'openGroup' | 'readGroup' | 'closeGroup', unknown>;
	const parent: DesktopPhotoOriginalDirectoryCurrentV1 = {
		getFileHandle: async () => { throw new Error('Only a private child can own a body.'); },
		async getDirectoryHandle(token: string, options: Readonly<{ create: boolean }>) {
			if (!options.create && !directories.has(token)) throw new DOMException('Missing', 'NotFoundError');
			if (options.create) { directories.add(token); event('stage-create'); } return directory(token);
		},
		async removeEntry(token: string) { event('remove-start'); await hooks.remove(); directories.delete(token); parts.delete(token); event('remove-end'); },
	};
	function directory(token: string): DesktopPhotoOriginalDirectoryCurrentV1 { return {
		getDirectoryHandle: async () => { throw new Error('Body stages have no child directories.'); },
		removeEntry: async () => { throw new Error('Only the parent removes an owned stage.'); },
		async getFileHandle(fileName: string) { return {
		async createWritable() {
			const copies: Uint8Array<ArrayBuffer>[] = []; parts.set(token, copies); event('writer-open');
			return { async write(bytes: Uint8Array<ArrayBuffer>) { event('write-start'); await hooks.write(); copies.push(bytes.slice()); written += bytes.byteLength; event('write-end'); },
				async close() { event('writer-close-start'); await hooks.writerClose(); event('writer-close-end'); },
				async abort() { event('writer-abort-start'); await hooks.abort(); event('writer-abort-end'); } };
		},
		async getFile() { event('get-file'); return hooks.file(new File(parts.get(token) ?? [], fileName)); },
	}; } }; }
	const storage: DesktopPhotoOriginalStorageCurrentV1 = { async getDirectory() { event('root'); return { async getDirectoryHandle() { return parent; }, getFileHandle: async () => { throw new Error('Only a private child can own the body.'); }, removeEntry: async () => { throw new Error('Cannot delete OPFS root.'); } }; } };
	const source = new DesktopPhotoOriginalSourceCurrentV1(transport, { storage, createId: () => `00000000-0000-4000-8000-${(++name).toString().padStart(12, '0')}` }) as OriginalGroupSourceCurrentV1;
	function track<Value extends Readonly<{ close(): Promise<void> }>>(work: Promise<Value>): Promise<Value> {
		operations.add(work); void work.then(value => { leases.add(value); operations.delete(work); }, () => { operations.delete(work); }); return work;
	}
	let retiring: Promise<void> | undefined;
	return { source, transport, hooks, events, ranges, gate, stop, storage,
		request(index = 0, bytes = Uint8Array.of(1, 2, 3, 4, 5), storageKey = `asset-${index}`): Readonly<Request> {
			const seed = originalStageRequestCurrentV1(bytes), photoId = `photo-${index}`; sources.set(photoId, bytes);
			return { ...seed, photoId, original: { ...seed.original, id: `source-${index}`, name: `Alias ${index}`, storageKey } };
		},
		replaceBytes(photoId: string, bytes?: Uint8Array<ArrayBuffer>) { if (bytes) sources.set(photoId, bytes); else sources.delete(photoId); },
		acquire(request: Readonly<Request>) { return track(source.acquire(request, { signal: stop.signal })); },
		acquireGroup(requests: unknown, caller?: AbortSignal) {
			return track(source.acquireGroup(requests, { signal: caller ? AbortSignal.any([caller, stop.signal]) : stop.signal }));
		},
		async reached(value: string, terminal: Promise<unknown>): Promise<void> {
			if (!events.includes(value)) await new Promise<void>((resolve, reject) => {
				const listeners = waiters.get(value) ?? new Set<() => void>(); listeners.add(resolve); waiters.set(value, listeners);
				void terminal.then(() => { if (!events.includes(value)) reject(new Error(`Missing actual ${value} receipt.`)); }, reject);
			}); context.signal.throwIfAborted();
		},
		counts: () => ({ stages: directories.size, written, reading, maximumReading, opens, groupOpens, groupCloses, groups: groups.size }),
		close(): Promise<void> {
			retiring ??= Promise.resolve().then(async () => {
				for (const value of gates) value.release(); stop.abort(new Error('Group test fixture closing.'));
				await Promise.allSettled([...operations]); await Promise.allSettled([...leases].map(value => value.close()));
				try { await source.close(); } finally { context.signal.removeEventListener('abort', cancel); }
			}); return retiring;
		},
	};
}
