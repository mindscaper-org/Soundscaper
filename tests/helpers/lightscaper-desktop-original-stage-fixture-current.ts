/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DesktopPhotoOriginalSourceCurrentV1, type DesktopPhotoOriginalTransportCurrentV1,
	type DesktopPhotoOriginalStorageCurrentV1 } from '../../src/lightscaper/desktop-photo-original-source-current-v1.ts';
import { normalizePhotoOriginalV1 } from '../../src/lightscaper/catalog/photo-document-envelope-v1.ts';
import type { PhotoLibraryOriginalRequestCurrentV1 } from '../../src/lightscaper/controller/photo-library-original-source-current-v1.ts';
import { deferred } from './async-test-control.ts';

export const ORIGINAL_STAGE_RANGE_CURRENT_V1 = 1024 * 1024;
export function originalStageRequestCurrentV1(bytes = Uint8Array.of(1, 2, 3, 4, 5)): PhotoLibraryOriginalRequestCurrentV1 {
	return { catalogId: 'catalog', photoId: 'photo', original: normalizePhotoOriginalV1({ schemaVersion: 1, kind: 'still', id: 'source',
		name: 'Original Ω.png', mimeType: 'image/png', storageKey: 'asset', contentSha256: shaOriginalStageCurrentV1(bytes),
		width: 1, height: 1, hasAlpha: false, byteLength: bytes.byteLength, retention: 'managed' }) };
}
export function shaOriginalStageCurrentV1(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export interface OriginalStageControlsCurrentV1 {
	readonly openGate?: ReturnType<typeof deferred<void>>;
	readonly readGate?: ReturnType<typeof deferred<void>>;
	readonly writeGate?: ReturnType<typeof deferred<void>>;
	readonly closeGate?: ReturnType<typeof deferred<void>>;
	readonly abortGate?: ReturnType<typeof deferred<void>>;
	readonly releaseGate?: ReturnType<typeof deferred<void>>;
	readonly writeFailure?: unknown; readonly closeFailure?: unknown; readonly abortFailure?: unknown; readonly removeFailure?: unknown;
	readonly readBytes?: (bytes: Uint8Array<ArrayBuffer>, offset: number, length: number) => Uint8Array<ArrayBuffer>;
	readonly file?: (parts: readonly Uint8Array<ArrayBuffer>[], name: string) => unknown;
	readonly ticket?: (request: PhotoLibraryOriginalRequestCurrentV1) => unknown;
	readonly collision?: boolean;
}

/** Instrumented filesystem/transport ports with genuine native File snapshots.
 * Real browser OPFS/native transport qualification is a separate spec. */
export function originalStageFixtureCurrentV1(bytes = Uint8Array.of(1, 2, 3, 4, 5), controls: OriginalStageControlsCurrentV1 = {}) {
	const events: string[] = [], ranges: Array<readonly [number, number]> = [], written = new Map<string, Uint8Array<ArrayBuffer>[]>();
	const directories = new Set<string>(), closedTickets: string[] = [];
	let next = 0, reading = 0, maximumReading = 0, sequence = 0;
	const request = originalStageRequestCurrentV1(bytes);
	const transport: DesktopPhotoOriginalTransportCurrentV1 = {
		async open(value) {
			events.push('open-start'); await controls.openGate?.promise; events.push('open-end');
			return controls.ticket ? controls.ticket(value) : { id: (++sequence).toString(16).padStart(64, '0'), original: value.original };
		},
		async read(_ticket, offset, length) {
			assert.ok(length >= 1 && length <= ORIGINAL_STAGE_RANGE_CURRENT_V1); reading++; maximumReading = Math.max(maximumReading, reading);
			ranges.push([offset, length]); events.push('read-start');
			try { await controls.readGate?.promise; return controls.readBytes ? controls.readBytes(bytes.slice(offset, offset + length), offset, length) : bytes.slice(offset, offset + length); }
			finally { reading--; events.push('read-end'); }
		},
		async close(ticket) { events.push('ticket-close-start'); await controls.releaseGate?.promise; closedTickets.push(ticket.id); events.push('ticket-close-end'); },
	};
	const parent = {
		async getDirectoryHandle(name: string, options: Readonly<{ create: boolean }>) {
			if (!options.create) {
				if (controls.collision || directories.has(name)) return directory(name);
				throw new DOMException('Missing', 'NotFoundError');
			}
			directories.add(name); events.push('stage-create'); return directory(name);
		},
		async removeEntry(name: string) {
			events.push('remove-start'); if (controls.removeFailure !== undefined) throw controls.removeFailure;
			directories.delete(name); written.delete(name); events.push('remove-end');
		},
	};
	function directory(token: string) {
		return { async getFileHandle(name: string) { return {
			async createWritable() {
				events.push('writer-open'); const parts: Uint8Array<ArrayBuffer>[] = []; written.set(token, parts);
				return { async write(chunk: Uint8Array<ArrayBuffer>) {
					events.push('write-start'); await controls.writeGate?.promise;
					if (controls.writeFailure !== undefined) throw controls.writeFailure;
					parts.push(chunk.slice()); events.push('write-end');
				}, async close() {
					events.push('writer-close-start'); await controls.closeGate?.promise;
					if (controls.closeFailure !== undefined) throw controls.closeFailure; events.push('writer-close-end');
				}, async abort() {
					events.push('writer-abort-start'); await controls.abortGate?.promise;
					if (controls.abortFailure !== undefined) throw controls.abortFailure; events.push('writer-abort-end');
				} };
			}, async getFile() {
				events.push('get-file'); const parts = written.get(token) ?? [];
				return controls.file ? controls.file(parts, name) : new File(parts, name);
			},
		}; } };
	}
	const storage = { async getDirectory() { events.push('root'); return { async getDirectoryHandle() { return parent; } }; } } as unknown as DesktopPhotoOriginalStorageCurrentV1;
	const source = new DesktopPhotoOriginalSourceCurrentV1(transport, { storage, createId: () => `00000000-0000-4000-8000-${(++next).toString().padStart(12, '0')}` });
	return { source, transport, request, events, ranges, closedTickets, stageCount: () => directories.size, maximumReading: () => maximumReading };
}
