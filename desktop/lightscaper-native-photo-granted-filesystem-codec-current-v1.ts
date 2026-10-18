/* SPDX-License-Identifier: AGPL-3.0-only */
import { win32 } from 'node:path';
const GET = Reflect.get, APPLY = Reflect.apply, KEYS = Reflect.ownKeys, DESCRIPTORS = Object.getOwnPropertyDescriptors;
const typed = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TAG = Object.getOwnPropertyDescriptor(typed, Symbol.toStringTag)!.get!;
const BYTE_LENGTH = Object.getOwnPropertyDescriptor(typed, 'byteLength')!.get!;
const BACKING = Object.getOwnPropertyDescriptor(typed, 'buffer')!.get!;
const ARRAY_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const SET = Uint8Array.prototype.set;
export const GRANTED_FS_OP_CURRENT_V1 = Object.freeze({ init: 1, rootOpen: 2, rootClose: 3, fileOpen: 4, read: 5,
	fileClose: 6, scanOpen: 7, next: 8, scanClose: 9, shutdown: 10 });
export type NativePath = Readonly<{ encoding: 'posix-bytes' | 'windows-utf16le'; bytes: Uint8Array }>;
export type NativeFileIdentity = Readonly<{ volume: string; object: string }>;
export type NativeEntry = Readonly<{ component: NativePath; kind: 'file' | 'directory' | 'link' | 'other' | 'unknown';
	byteLength: number | null; observation: Uint8Array | null; identity: NativeFileIdentity | null }>;
export type NativePage = Readonly<{ entries: readonly NativeEntry[]; done: boolean }>;
export function ownRecord(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
	if (value === null || typeof value !== 'object') throw new TypeError('Native filesystem input must be an own record.');
	const descriptors = DESCRIPTORS(value), result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of KEYS(descriptors)) {
		if (typeof key !== 'string' || !allowed.includes(key)) throw new TypeError('Unknown native filesystem field.');
		const descriptor = GET(descriptors, key) as PropertyDescriptor;
		if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('Native filesystem accessors are not admitted.'); result[key] = descriptor.value;
	}
	for (const key of required) if (!Object.hasOwn(result, key)) throw new TypeError('Missing native filesystem field.'); return result;
}
export function copyNativeBytes(value: unknown, maximum: number): Uint8Array {
	if (APPLY(TAG, value, []) !== 'Uint8Array') throw new TypeError('A genuine native Uint8Array is required.');
	const length: unknown = APPLY(BYTE_LENGTH, value, []), backing: unknown = APPLY(BACKING, value, []);
	if (!Number.isSafeInteger(length) || typeof length !== 'number' || length < 0 || length > maximum) throw new RangeError('Native byte vector exceeds its bound.');
	APPLY(ARRAY_LENGTH, backing, []); const result = new Uint8Array(length); APPLY(SET, result, [value]); return result;
}
export function captureNativePath(value: unknown, root: boolean): NativePath {
	const row = ownRecord(value, ['encoding', 'bytes']);
	const windows = process.platform === 'win32', encoding = windows ? 'windows-utf16le' : 'posix-bytes';
	if (row.encoding !== encoding) throw new TypeError('Native path encoding does not match this target.');
	const bytes = copyNativeBytes(row.bytes, (root ? 32768 : 4096) * (windows ? 2 : 1));
	if (!bytes.byteLength || (windows && bytes.byteLength % 2)) throw new TypeError('Invalid native path length.');
	const units: number[] = [];
	for (let index = 0; index < bytes.length; index += windows ? 2 : 1) { const unit = bytes[index]! | (windows ? bytes[index + 1]! << 8 : 0); if (!unit) throw new TypeError('Native paths cannot contain NUL.'); units.push(unit); }
	if (root) {
		if (windows ? !win32.isAbsolute(Buffer.from(bytes).toString('utf16le')) : bytes[0] !== 47) throw new TypeError('Native root must be absolute.');
	} else if ((units.length === 1 && units[0] === 46) || (units.length === 2 && units.every(unit => unit === 46))
		|| units.includes(47) || (windows && (units.includes(92) || units.includes(58)))) throw new TypeError('Native path requires exact relative components.');
	return Object.freeze({ encoding, bytes });
}
export function captureComponents(value: unknown, empty: boolean): readonly NativePath[] {
	if (!Array.isArray(value) || value.length > 16 || (!empty && !value.length)) throw new TypeError('Native component count is invalid.');
	const keys = KEYS(value); if (keys.length !== value.length + 1) throw new TypeError('Native components must be a dense vector.');
	const result: NativePath[] = []; for (let index = 0; index < value.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Native component accessor or hole.');
		result.push(captureNativePath(descriptor.value, false));
	} return Object.freeze(result);
}
export function captureIdentity(value: unknown): NativeFileIdentity {
	const row = ownRecord(value, ['volume', 'object']);
	for (const key of ['volume', 'object']) if (typeof row[key] !== 'string' || !/^[\x20-\x7e]{1,256}$/u.test(row[key])) throw new TypeError('Invalid native identity.');
	return Object.freeze({ volume: String(row.volume), object: String(row.object) });
}
export class NativeWriter {
	#parts: Buffer[] = []; #length = 0;
	raw(value: Uint8Array): this { this.#length += value.byteLength; if (this.#length > 262144) throw new RangeError('Native control frame exceeds its bound.'); this.#parts.push(Buffer.from(value)); return this; }
	number(value: number | bigint, count: number): this { const bytes = Buffer.alloc(count); let current = BigInt(value); for (let index = count - 1; index >= 0; index--) { bytes[index] = Number(current & 255n); current >>= 8n; } return this.raw(bytes); }
	path(value: NativePath): this { return this.number(value.encoding === 'posix-bytes' ? 1 : 2, 1).number(value.bytes.length, 4).raw(value.bytes); }
	identity(value: NativeFileIdentity): this { for (const field of [value.volume, value.object]) { const bytes = Buffer.from(field, 'ascii'); this.number(bytes.length, 2).raw(bytes); } return this; }
	components(value: readonly NativePath[]): this { this.number(value.length, 1); for (const path of value) this.path(path); return this; }
	finish(): Buffer { return Buffer.concat(this.#parts, this.#length); }
}
export class NativeReader {
	#value: Buffer; #offset = 0;
	constructor(value: Uint8Array) { this.#value = Buffer.from(value); }
	raw(length: number): Uint8Array { if (length < 0 || length > this.#value.length - this.#offset) throw new Error('Native peer returned a truncated field.'); const result = new Uint8Array(this.#value.subarray(this.#offset, this.#offset + length)); this.#offset += length; return result; }
	big(count: number): bigint { let value = 0n; for (const byte of this.raw(count)) value = (value << 8n) | BigInt(byte); return value; }
	number(count: number): number { const value = this.big(count); if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Native scalar exceeds the safe integer range.'); return Number(value); }
	identity(): NativeFileIdentity { const fields: string[] = []; for (let index = 0; index < 2; index++) { const count = this.number(2); if (!count || count > 256) throw new Error('Native identity exceeds its bound.'); const bytes = this.raw(count); for (const byte of bytes) if (byte < 32 || byte > 126) throw new Error('Invalid native identity bytes.'); fields.push(Buffer.from(bytes).toString('ascii')); } return captureIdentity({ volume: fields[0], object: fields[1] }); }
	path(): NativePath { const encoding = this.number(1), length = this.number(4); if (length > 8192) throw new Error('Native name exceeds its bound.'); return captureNativePath({ encoding: encoding === 1 ? 'posix-bytes' : encoding === 2 ? 'windows-utf16le' : null, bytes: this.raw(length) }, false); }
	end(): void { if (this.#offset !== this.#value.length) throw new Error('Native peer returned trailing fields.'); }
}
const UNPROVED = new WeakSet<object>();
export class NativeGrantedFilesystemError extends Error {
	readonly code: number; readonly phase: number; readonly nativeCode: number;
	constructor(code: number, phase: number, nativeCode: number) { super('Native granted filesystem operation refused.'); this.name = 'NativeGrantedFilesystemError'; this.code = code; this.phase = phase; this.nativeCode = nativeCode; }
}
export function readNativeError(value: Uint8Array): NativeGrantedFilesystemError {
	const reader = new NativeReader(value), code = reader.number(2), phase = reader.number(1), native = reader.number(4), flags = reader.number(1), length = reader.number(2);
	if (!code || flags > 1 || length > 1024) throw new Error('Native error frame is invalid.');
	for (const byte of reader.raw(length)) if (byte < 32 || byte > 126) throw new Error('Native diagnostic is invalid.'); reader.end();
	const error = new NativeGrantedFilesystemError(code, phase, native); if (flags) UNPROVED.add(error); return error;
}
export function nativeRetirementIsUnproved(value: unknown): boolean { return typeof value === 'object' && value !== null && UNPROVED.has(value); }
export function readNativePage(value: Uint8Array): NativePage {
	if (value.byteLength > 65536) throw new Error('Native scan page exceeds its bound.'); const reader = new NativeReader(value), done = reader.number(1), count = reader.number(2);
	if (done > 1 || count > 64) throw new Error('Native scan page is invalid.'); const entries: NativeEntry[] = [];
	const kinds = ['file', 'directory', 'link', 'other', 'unknown'] as const;
	for (let index = 0; index < count; index++) {
		const kind = reader.number(1); if (kind < 1 || kind > 5) throw new Error('Native entry kind is invalid.'); const component = reader.path(), size = reader.big(8);
		if (size !== 0xffffffffffffffffn && size > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Native entry size exceeds the safe integer range.');
		const observed = reader.number(1); if (observed > 1) throw new Error('Invalid native observation.'); const observation = observed ? reader.raw(16) : null;
		const identified = reader.number(1); if (identified > 1) throw new Error('Invalid native identity presence.'); const identity = identified ? reader.identity() : null;
		entries.push(Object.freeze({ component, kind: kinds[kind - 1]!, byteLength: size === 0xffffffffffffffffn ? null : Number(size), observation, identity }));
	} reader.end(); return Object.freeze({ entries: Object.freeze(entries), done: done === 1 });
}
