/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainRecord as record } from '../common/foundation/closed-domain-value.ts';
import { DesktopPhotoRawSourceCurrentV1 as Source } from './desktop-photo-raw-source-current-v1.ts';
import { readDesktopPhotoRawRetirementCurrentV1 as retired, type DesktopPhotoRawOpenCurrentV1 as Open } from './desktop-photo-raw-contract-current-v1.ts';
import { readPhotoLibraryRawImportRequestCurrentV1 as request, type PhotoLibraryRawImportSourceCurrentV1 as ImportSource } from './controller/photo-library-raw-import-current-v1.ts';
import type { PhotoLibraryRawSourceCurrentV1 as RawSource } from './controller/photo-library-raw-source-current-v1.ts';
import { readDesktopPhotoLibrarySessionHandleCurrentV1 as handle, type DesktopPhotoLibrarySessionHandleCurrentV1 as Handle } from './desktop-photo-library-session-protocol-current-v1.ts';
import { DesktopPhotoSessionClientCallsCurrentV1 as Calls, desktopPhotoVoidCurrentV1 as empty, desktopPhotoBooleanCurrentV1 as boolean, desktopPhotoSignalCurrentV1 as signalOf } from './desktop-photo-library-session-client-calls-current-v1.ts';
import { copyDesktopPhotoBytesCurrentV1 as copy, digestDesktopPhotoBlobCurrentV1 as digest, desktopPhotoDigestCurrentV1 as sha } from './desktop-photo-library-session-transfer-client-current-v1.ts';
const SLICE = Blob.prototype.slice, READ = Blob.prototype.arrayBuffer, FILL = Uint8Array.prototype.fill, CHECK = AbortSignal.prototype.throwIfAborted;
const QUARANTINE = new Set<object>();
/** One installed RAW owner joins native output and its unfinished input uploads
 * in the real renderer retirement barrier. Every consumer is a tracked call. */
export function createDesktopPhotoSessionRawClientCurrentV1(c: Calls) {
	const source = new Source({
		open: (request, options) => c.send('rawOpen', () => ({ request }), value => value as Open, options?.signal, false, true),
		read: (ticket, offset, length) => c.send('rawRead', () => ({ ticket, offset, length }), value => { try { return copy(value); } finally { Reflect.apply(FILL, value, [0]); } }),
		close: ticket => c.send('rawClose', () => ({ ticket }), retired, undefined, true, true),
	}, { signal: c.signal });
	const sourceClose = source.close, sourceInput = source.forInput, operations = new Set<Promise<unknown>>();
	let cleanupFailure: unknown, cleanupFailed = false;
	let busy = false, stopped = false, closing: Promise<void> | undefined;
	const raw = Object.freeze<RawSource>({ withFrame: (...args) => c.own(() => source.raw.withFrame(...args)), withPreview: (...args) => c.own(() => source.raw.withPreview(...args)) });
	const forInput = (id: string): Readonly<ImportSource> => {
		const actual = Reflect.apply(sourceInput, source, [id]) as Readonly<ImportSource>;
		return Object.freeze<ImportSource>({ withFrame: (...args) => c.own(() => actual.withFrame(...args)) });
	};
	const rawImport = Object.freeze<ImportSource>({ withFrame: (borrowed, consume, options) => {
		try { c.assert(); if (busy || stopped) throw new Error('Desktop RAW input is occupied or closed.'); } catch (error) { return Promise.reject(error); }
		busy = true;
		const work = c.own(async () => {
			let receivedBegin = false;
			let issued: Readonly<Handle> | undefined, release: (() => void) | undefined, primary: unknown, failed = false;
			const deliver = async () => {
				const signal = signalOf(options), selected = request(borrowed); if (signal) Reflect.apply(CHECK, signal, []);
				const capturedOptions = Object.freeze(signal === undefined ? {} : { signal });
				if (!await c.send('rawInput', () => ({ operation: 'available' }), boolean, signal)) return Object.freeze({ outcome: 'web-fallback' as const, reason: 'native-unavailable' as const });
				release = c.reserve(selected.body.size);
				if (await digest(selected.body, signal) !== selected.contentSha256) throw new Error('RAW input body differs from its complete SHA-256.');
				const opened = await c.send('rawInput', () => ({ operation: 'begin', expectedBytes: selected.body.size, expectedSha256: selected.contentSha256 }), value => value, signal, false, true);
				receivedBegin = true;
				// Capture a real issued handle before validating other reply fields.
				const descriptor = opened && typeof opened === 'object' ? Object.getOwnPropertyDescriptor(opened, 'handle') : undefined;
				if (descriptor && Object.hasOwn(descriptor, 'value')) issued = handle(descriptor.value, 'raw-input');
				const row = record(opened, 'native RAW upload begin', ['handle', 'maximumChunkBytes', 'bytesWritten']); if (!issued || handle(row.handle, 'raw-input').id !== issued.id || row.maximumChunkBytes !== 1_048_576 || row.bytesWritten !== 0) throw new Error('RAW upload has no actual retirement identity.');
				let sequence = 0;
				for (let offset = 0; offset < selected.body.size;) {
					c.assert(); if (signal) Reflect.apply(CHECK, signal, []);
					const end = Math.min(offset + 1_048_576, selected.body.size), part = Reflect.apply(SLICE, selected.body, [offset, end]) as Blob;
					const bytes = new Uint8Array(await (Reflect.apply(READ, part, []) as Promise<ArrayBuffer>));
					try { await c.send('rawInput', () => ({ operation: 'write', handle: issued, sequence, offset, bytes }), value => { const ack = record(value, 'native RAW input chunk receipt', ['sequence', 'offset']); if (ack.sequence !== sequence || ack.offset !== end) throw new Error('Native RAW input write acknowledgement changed.'); }, signal); }
					finally { Reflect.apply(FILL, bytes, [0]); } offset = end; sequence++;
				}
				const finished = await c.send('rawInput', () => ({ operation: 'finish', handle: issued }), value => record(value, 'native RAW completed input', ['handle', 'byteLength', 'contentSha256']), signal, false, true);
				if (handle(finished.handle, 'raw-input').id !== issued.id || finished.byteLength !== selected.body.size || sha(finished.contentSha256) !== selected.contentSha256) throw new Error('Native RAW completed upload identity changed.');
				return await forInput(issued.id).withFrame(selected, consume, capturedOptions);
			};
			let result: Awaited<ReturnType<typeof deliver>> | undefined;
			try { result = await deliver(); } catch (error) { failed = true; primary = error; }
			{
				if (issued) try { await c.send('rawInput', () => ({ operation: 'close', handle: issued }), empty, undefined, true, true); }
				catch (cleanup) { cleanupFailed = true; cleanupFailure = cleanup; stopped = true; c.notice(cleanup); c.stop(); QUARANTINE.add({ issued, release, source, cleanup }); throw failed ? new AggregateError([primary, cleanup], 'RAW input and actual upload retirement failed.', { cause: cleanup }) : cleanup; }
				if (receivedBegin && !issued) { const cleanup = new Error('Native RAW begin has no provable upload retirement identity.'); cleanupFailed = true; cleanupFailure = cleanup; stopped = true; c.notice(cleanup); c.stop(); QUARANTINE.add({ release, source, cleanup }); throw failed ? new AggregateError([primary, cleanup], 'RAW upload admission and retirement failed.', { cause: cleanup }) : cleanup; }
				release?.();
			}
			if (failed) throw primary;
			if (!result) throw new Error('Native RAW input has no completed result.');
			return result;
		}); operations.add(work); void work.then(() => { operations.delete(work); busy = false; }, () => { operations.delete(work); busy = false; }); return work;
	} });
	return Object.freeze({ raw, rawImport, forInput, close(): Promise<void> {
		if (closing) return closing; stopped = true;
		closing = Promise.resolve().then(async () => {
			const results = await Promise.allSettled([Reflect.apply(sourceClose, source, []) as Promise<void>, ...operations]);
			// Ordinary cancelled import operations have already joined their
			// cleanup; source.close carries physical output retirement failures.
			const output = results[0]!; if (output.status === 'rejected') throw output.reason; if (cleanupFailed) throw cleanupFailure;
		}); return closing;
	} });
}
