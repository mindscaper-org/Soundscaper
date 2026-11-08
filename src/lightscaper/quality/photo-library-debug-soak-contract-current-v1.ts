/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CreatePhotoLibrarySessionCurrentV1 } from '../../common/editor/photo-library-session-port-current-v1.ts';
import type { DesktopPhotoOriginalStorageCurrentV1 } from '../desktop-photo-original-contract-current-v1.ts';
export type DebugPhaseCurrentV1 = 'import' | 'browse' | 'search' | 'save' | 'export' | 'restore' | 'close' | 'reopen';
export interface DebugPhaseReceiptCurrentV1 { readonly iteration: number; readonly phase: DebugPhaseCurrentV1; readonly elapsedMilliseconds: number; readonly count: number; readonly memory: DebugMemoryCurrentV1; readonly owners: Readonly<{ activeSessions: number; activeExports: number }> }
export interface DebugOutputCurrentV1 { readonly iteration: number; readonly photoId: string; readonly width: number; readonly height: number; readonly byteLength: number; readonly sha256: string; readonly pixelsSha256: string }
export interface DebugOwnersCurrentV1 { sessionsOpened: number; sessionsClosed: number; maximumLiveSessions: number; activeSessions: number; activeExports: number; joined: boolean }
export interface DebugSoakOptionsCurrentV1 {
	readonly createSession: CreatePhotoLibrarySessionCurrentV1; readonly files: readonly File[]; readonly iterations?: number;
	readonly signal?: AbortSignal; readonly storage?: DesktopPhotoOriginalStorageCurrentV1;
	readonly onPhase?: (value: Readonly<DebugPhaseReceiptCurrentV1>) => void;
}
export type DebugMemoryCurrentV1 = Readonly<{ kind: 'browser-js-heap'; usedJSHeapSize: number }> | Readonly<{ kind: 'unavailable'; reason: 'browser-heap-api-unavailable' }>;
export interface DebugSoakReportCurrentV1 {
	readonly schemaVersion: 1; readonly kind: 'photo-library-debug-soak'; readonly iterations: number; readonly importedPhotos: number;
	readonly phases: readonly Readonly<DebugPhaseReceiptCurrentV1>[]; readonly originals: readonly Readonly<{ photoId: string; sha256: string; byteLength: number }>[];
	readonly outputs: readonly Readonly<DebugOutputCurrentV1>[]; readonly owners: Readonly<DebugOwnersCurrentV1>; readonly memory: DebugMemoryCurrentV1;
}
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;
const NAME = Object.getOwnPropertyDescriptor(File.prototype, 'name')!.get!, CHECK = AbortSignal.prototype.throwIfAborted;
const FAILURES = new WeakSet<object>(), QUARANTINE = new Set<object>();
export function bindDebugMethodCurrentV1<T extends (...args: never[]) => unknown>(method: T, receiver: unknown): T {
	if (typeof method !== 'function') throw new TypeError('Diagnostic owner method is unavailable.');
	return ((...args: Parameters<T>) => Reflect.apply(method, receiver, args)) as T;
}
export function debugCheckCurrentV1(signal?: AbortSignal): void { if (signal) Reflect.apply(CHECK, signal, []); }
export function captureDebugFilesCurrentV1(files: readonly File[], iterations = 3): readonly File[] {
	if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100) throw new RangeError('Diagnostic rounds must be between 1 and 100.');
	if (!Array.isArray(files) || files.length < 1 || files.length > 32) throw new RangeError('Choose 1–32 tiny diagnostic files.');
	let total = 0; const result: File[] = [];
	for (let at = 0; at < files.length; at++) {
		const descriptor = Object.getOwnPropertyDescriptor(files, at); if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Diagnostic files must be a dense File vector.');
		const file: unknown = descriptor.value, size = Number(Reflect.apply(SIZE, file, [])); Reflect.apply(NAME, file, []);
		if (!Number.isSafeInteger(size) || size <= 0 || size > 64 * 1024 * 1024 - total) throw new RangeError('Diagnostic source corpus exceeds 64 MiB.');
		total += size; result.push(file as File);
	}
	return Object.freeze(result);
}
export function debugCleanupFailureCurrentV1(primary: readonly unknown[], cleanup: unknown, owner: object): AggregateError {
	QUARANTINE.add(owner); const error = new AggregateError([...primary, cleanup], 'Library diagnostic cleanup is unproved; actual owners retained.', { cause: cleanup }); FAILURES.add(error); return error;
}
export function isDebugCleanupFailureCurrentV1(value: unknown): boolean { return typeof value === 'object' && value !== null && FAILURES.has(value); }
export function debugMemoryCurrentV1(): DebugMemoryCurrentV1 {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis.performance, 'memory');
	try { const memory: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : Reflect.get(globalThis.performance, 'memory');
		if (typeof memory === 'object' && memory !== null) { const used: unknown = Reflect.get(memory, 'usedJSHeapSize');
			if (typeof used === 'number' && Number.isSafeInteger(used) && used >= 0) return Object.freeze({ kind: 'browser-js-heap', usedJSHeapSize: used }); }
	} catch { /* Optional browser measurement cannot replace an actual value. */ }
	return Object.freeze({ kind: 'unavailable', reason: 'browser-heap-api-unavailable' });
}
