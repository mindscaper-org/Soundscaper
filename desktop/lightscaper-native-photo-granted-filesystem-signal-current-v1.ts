/* SPDX-License-Identifier: AGPL-3.0-only */
import { ownRecord } from './lightscaper-native-photo-granted-filesystem-codec-current-v1.ts';
const APPLY = Reflect.apply, THROW = AbortSignal.prototype.throwIfAborted;
const ADD = EventTarget.prototype.addEventListener, REMOVE = EventTarget.prototype.removeEventListener;
export function captureNativeFilesystemSignal(value: unknown): AbortSignal | undefined {
	if (value === undefined) return undefined;
	// The intrinsic validates the native brand before any caller methods.
	APPLY(THROW, value, []); return value as AbortSignal;
}
export function captureNativeFilesystemOptions(value: unknown): AbortSignal | undefined {
	if (value === undefined) return undefined; return captureNativeFilesystemSignal(ownRecord(value, ['signal'], []).signal);
}
export function checkNativeFilesystemSignal(signal: AbortSignal | undefined): void { if (signal) APPLY(THROW, signal, []); }
export function linkNativeFilesystemSignal(signal: AbortSignal | undefined, stop: () => void): () => void {
	if (!signal) return () => {}; APPLY(ADD, signal, ['abort', stop, { once: true }]);
	return () => { APPLY(REMOVE, signal, ['abort', stop]); };
}
