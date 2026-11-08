/* SPDX-License-Identifier: AGPL-3.0-only */

const NativeBytes = Uint8Array, TYPED = Object.getPrototypeOf(NativeBytes.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!, LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const TAG = Object.getOwnPropertyDescriptor(TYPED, Symbol.toStringTag)!.get!, SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!, SET = NativeBytes.prototype.set;
export const DESKTOP_PHOTO_TRANSFER_BYTES_CURRENT_V1 = 1_048_576;

/** Copy an actual native view before its first await; reject shared storage. */
export function copyDesktopPhotoBytesCurrentV1(value: unknown, maximum = DESKTOP_PHOTO_TRANSFER_BYTES_CURRENT_V1): Uint8Array<ArrayBuffer> {
	if (Reflect.apply(TAG, value, []) !== 'Uint8Array') throw new TypeError('Desktop bytes require a native Uint8Array.');
	const length = Reflect.apply(LENGTH, value, []) as number, backing: unknown = Reflect.apply(BUFFER, value, []);
	Reflect.apply(SIZE, backing, []); // Genuine ArrayBuffer, including cross-realm; SharedArrayBuffer refuses.
	if (!Number.isSafeInteger(maximum) || maximum < 0 || length > maximum) throw new RangeError('Desktop transfer chunk exceeds its bound.');
	const bytes = new NativeBytes(length); Reflect.apply(SET, bytes, [value]); return bytes;
}
export function desktopPhotoDigestCurrentV1(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Desktop SHA-256 required.'); return value; }
