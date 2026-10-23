/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeProjectBinaryLimits } from './scape-project-document.ts';

export const BINARY_TAG = '$soundscaperOpaqueBinary';
export const BINARY_DESCRIPTOR_SCHEMA_VERSION = 1;
export const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export const OMIT = Symbol('omit');
const OPEN_ARRAY = Symbol('['), CLOSE_ARRAY = Symbol(']');
const OPEN_OBJECT = Symbol('{'), CLOSE_OBJECT = Symbol('}');
const COMMA = Symbol(','), COLON = Symbol(':');
const JSON_PUNCTUATION = new Map<symbol, string>([
	[OPEN_ARRAY, '['], [CLOSE_ARRAY, ']'], [OPEN_OBJECT, '{'], [CLOSE_OBJECT, '}'], [COMMA, ','], [COLON, ':'],
]);

export type ScapeProjectJsonToken = string | number | boolean | null | symbol
	| Readonly<{ serialized: string }> | Readonly<{ encoded: object }>;
type EmitJsonToken = (token: ScapeProjectJsonToken) => void;

export function serializeScapeProjectJsonTokens(tokens: readonly ScapeProjectJsonToken[]): string {
	return tokens.map((token) => {
		if (typeof token === 'symbol') return JSON_PUNCTUATION.get(token)!;
		if (token && typeof token === 'object') return 'serialized' in token ? token.serialized : JSON.stringify(token.encoded);
		return JSON.stringify(token);
	}).join('');
}

/** Rebuild already-detached values only when traversal introduced JSON hooks. */
export function materializeScapeProjectJsonTokens(tokens: readonly ScapeProjectJsonToken[]): unknown {
	let cursor = 0;
	const read = (): unknown => {
		const token = tokens[cursor++];
		if (token === OPEN_ARRAY) {
			const value: unknown[] = [];
			while (tokens[cursor] !== CLOSE_ARRAY) {
				value.push(read());
				if (tokens[cursor] !== COMMA) break;
				cursor += 1;
			}
			cursor += 1;
			return value;
		}
		if (token === OPEN_OBJECT) {
			const value = Object.create(null) as Record<string, unknown>;
			while (tokens[cursor] !== CLOSE_OBJECT) {
				const key = tokens[cursor++] as string;
				cursor += 1;
				Object.defineProperty(value, key, enumerableData(read()));
				if (tokens[cursor] !== COMMA) break;
				cursor += 1;
			}
			cursor += 1;
			return value;
		}
		if (token && typeof token === 'object') {
			return 'encoded' in token ? token.encoded : JSON.parse(token.serialized) as unknown;
		}
		return token;
	};
	return read();
}
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = requiredGetter(ArrayBuffer.prototype, 'byteLength');
const TYPED_ARRAY_BYTE_LENGTH_GETTER = requiredGetter(Object.getPrototypeOf(Uint8Array.prototype) as object, 'byteLength');

export interface BinaryDescriptor {
	readonly schemaVersion: 1;
	readonly id: number;
	readonly type: 'Uint8Array' | 'ArrayBuffer';
	readonly byteLength: number;
	readonly base64: string;
}

interface BinaryBudget {
	readonly limits: Readonly<ScapeProjectBinaryLimits>;
	nodes: number;
	payloadCount: number;
	totalPayloadBytes: number;
}

interface EncodeBudget extends BinaryBudget {
	readonly active: Set<object>;
}

/** The same admission and traversal serve detached values and canonical JSON tokens. */
export function encodeScapeProjectDocumentValue(
	value: unknown,
	limits: Readonly<ScapeProjectBinaryLimits>,
	emit?: EmitJsonToken,
): unknown | typeof OMIT {
	return encodeValue(value, 0, { limits, active: new Set(), nodes: 0, payloadCount: 0, totalPayloadBytes: 0 }, emit);
}

function encodeValue(value: unknown, depth: number, budget: EncodeBudget, emit?: EmitJsonToken): unknown | typeof OMIT {
	admitTraversal(depth, budget);
	if (value === null || typeof value === 'string' || typeof value === 'boolean') {
		emit?.(value);
		return value;
	}
	if (typeof value === 'number') {
		const normalized = Number.isFinite(value) ? value : null;
		emit?.(normalized);
		return normalized;
	}
	if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return OMIT;
	if (typeof value === 'bigint') throw new TypeError('Scape project BigInt values are not JSON-compatible.');
	if (value instanceof Uint8Array) {
		const encoded = encodeUint8Array(value, budget);
		emit?.({ encoded });
		return encoded;
	}
	if (value instanceof ArrayBuffer) {
		const encoded = encodeArrayBuffer(value, budget);
		emit?.({ encoded });
		return encoded;
	}
	if (ArrayBuffer.isView(value)) {
		throw new TypeError('Only Uint8Array and ArrayBuffer opaque binary values are supported.');
	}
	if (Array.isArray(value)) return encodeArray(value, depth, budget, emit);
	if (!isPlainObject(value)) {
		throw new TypeError('Scape projects must contain only JSON-compatible objects and supported binary values.');
	}
	return encodeObject(value, depth, budget, emit);
}

function encodeArray(value: unknown[], depth: number, budget: EncodeBudget, emit?: EmitJsonToken): unknown[] | null {
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError('Scape project arrays must use the ordinary Array prototype.');
	}
	assertNoToJSONHook(value as unknown as Record<string, unknown>);
	enterContainer(value, budget);
	try {
		assertChildrenFitTraversal(value.length, budget);
		const encoded: unknown[] | null = emit ? null : [];
		emit?.(OPEN_ARRAY);
		for (let index = 0; index < value.length; index += 1) {
			if (index) emit?.(COMMA);
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (!descriptor) {
				admitTraversal(depth + 1, budget);
				encoded?.push(null);
				emit?.(null);
				continue;
			}
			const child = dataPropertyValue(descriptor, `array index ${String(index)}`);
			const result = encodeValue(child, depth + 1, budget, emit);
			encoded?.push(result === OMIT ? null : result);
			if (result === OMIT) emit?.(null);
		}
		emit?.(CLOSE_ARRAY);
		return encoded;
	} finally {
		budget.active.delete(value);
	}
}

function encodeObject(
	value: Record<string, unknown>,
	depth: number,
	budget: EncodeBudget,
	emit?: EmitJsonToken,
): Record<string, unknown> | null {
	if (Object.hasOwn(value, BINARY_TAG)) {
		throw new TypeError(`The reserved ${BINARY_TAG} tag collides with ordinary project data.`);
	}
	assertNoToJSONHook(value);
	enterContainer(value, budget);
	try {
		const keys = Object.keys(value);
		assertChildrenFitTraversal(keys.length, budget);
		// A Proxy may expose integer keys out of order. Defining the detached object
		// restores JSON's integer ordering without revisiting the source or its traps.
		const stream = emit && hasCanonicalKeyOrder(keys) ? emit : undefined;
		const encoded = stream ? null : Object.create(null) as Record<string, unknown>;
		stream?.(OPEN_OBJECT);
		let separated = false;
		for (const key of keys) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor) throw new TypeError(`Scape project property ${key} is unavailable.`);
			const child = dataPropertyValue(descriptor, `property ${key}`);
			if (stream && child !== undefined && typeof child !== 'function' && typeof child !== 'symbol') {
				if (separated) stream(COMMA);
				stream(key);
				stream(COLON);
				separated = true;
			}
			const result = encodeValue(child, depth + 1, budget, stream);
			if (encoded && result !== OMIT) Object.defineProperty(encoded, key, enumerableData(result));
		}
		stream?.(CLOSE_OBJECT);
		if (emit && encoded) emit({ encoded });
		return encoded;
	} finally {
		budget.active.delete(value);
	}
}

function hasCanonicalKeyOrder(keys: readonly string[]): boolean {
	let lastIndex = -1;
	let sawOrdinaryKey = false;
	for (const key of keys) {
		const first = key.charCodeAt(0);
		const index = first >= 48 && first <= 57 ? Number(key) : -1;
		const integerKey = Number.isInteger(index) && index >= 0 && index < 0xffff_ffff && String(index) === key;
		if (integerKey) {
			if (sawOrdinaryKey || index <= lastIndex) return false;
			lastIndex = index;
		} else sawOrdinaryKey = true;
	}
	return true;
}

function enterContainer(value: object, budget: EncodeBudget): void {
	if (budget.active.has(value)) throw new TypeError('Cyclic Scape project values are not supported.');
	budget.active.add(value);
}

function dataPropertyValue(descriptor: PropertyDescriptor, name: string): unknown {
	if (!Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Scape project ${name} accessors are not supported.`);
	}
	return descriptor.value;
}

function assertNoToJSONHook(value: Record<string, unknown>): void {
	const descriptor = Object.getOwnPropertyDescriptor(value, 'toJSON');
	if (!descriptor) return;
	const candidate = dataPropertyValue(descriptor, 'toJSON');
	if (typeof candidate === 'function') {
		throw new TypeError('Scape project toJSON hooks are not supported.');
	}
}

function enumerableData(value: unknown): PropertyDescriptor {
	return { value, enumerable: true, configurable: true, writable: true };
}

function encodeUint8Array(value: Uint8Array, budget: EncodeBudget): Record<string, BinaryDescriptor> {
	const byteLength = intrinsicByteLength(TYPED_ARRAY_BYTE_LENGTH_GETTER, value);
	admitBinary(byteLength, budget);
	const bytes = new Uint8Array(byteLength);
	Uint8Array.prototype.set.call(bytes, value);
	return encodedBinaryTag(bytes, 'Uint8Array', budget.payloadCount);
}

function encodeArrayBuffer(value: ArrayBuffer, budget: EncodeBudget): Record<string, BinaryDescriptor> {
	const byteLength = intrinsicByteLength(ARRAY_BUFFER_BYTE_LENGTH_GETTER, value);
	admitBinary(byteLength, budget);
	const bytes = new Uint8Array(byteLength);
	Uint8Array.prototype.set.call(bytes, new Uint8Array(value));
	return encodedBinaryTag(bytes, 'ArrayBuffer', budget.payloadCount);
}

function encodedBinaryTag(bytes: Uint8Array, type: BinaryDescriptor['type'], id: number): Record<string, BinaryDescriptor> {
	return { [BINARY_TAG]: { schemaVersion: BINARY_DESCRIPTOR_SCHEMA_VERSION, id, type, byteLength: bytes.byteLength, base64: encodeBase64(bytes) } };
}

export function admitTraversal(depth: number, budget: Pick<BinaryBudget, 'limits' | 'nodes'>): void {
	if (depth > budget.limits.maximumTraversalDepth) {
		throw new RangeError('The Scape project exceeds the binary traversal depth limit.');
	}
	budget.nodes += 1;
	if (budget.nodes > budget.limits.maximumTraversalNodes) {
		throw new RangeError('The Scape project exceeds the binary traversal node limit.');
	}
}

export function assertChildrenFitTraversal(childCount: number, budget: Pick<BinaryBudget, 'limits' | 'nodes'>): void {
	if (childCount > budget.limits.maximumTraversalNodes - budget.nodes) {
		throw new RangeError('The Scape project exceeds the binary traversal node limit.');
	}
}

export function admitBinary(byteLength: number, budget: Pick<BinaryBudget, 'limits' | 'payloadCount' | 'totalPayloadBytes'>): void {
	if (byteLength > budget.limits.maximumPayloadBytes) {
		throw new RangeError('A Scape opaque binary payload exceeds its byte limit.');
	}
	const payloadCount = budget.payloadCount + 1;
	if (payloadCount > budget.limits.maximumPayloadCount) {
		throw new RangeError('The Scape project has too many opaque binary payloads.');
	}
	const totalPayloadBytes = budget.totalPayloadBytes + byteLength;
	if (totalPayloadBytes > budget.limits.maximumTotalPayloadBytes) {
		throw new RangeError('The Scape project exceeds its aggregate opaque binary byte limit.');
	}
	budget.payloadCount = payloadCount;
	budget.totalPayloadBytes = totalPayloadBytes;
}

function encodeBase64(bytes: Uint8Array): string {
	let output = '';
	for (let index = 0; index < bytes.length; index += 3) {
		const first = bytes[index] ?? 0;
		const second = bytes[index + 1];
		const third = bytes[index + 2];
		const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
		output += BASE64_ALPHABET[(combined >>> 18) & 63];
		output += BASE64_ALPHABET[(combined >>> 12) & 63];
		output += second === undefined ? '=' : BASE64_ALPHABET[(combined >>> 6) & 63];
		output += third === undefined ? '=' : BASE64_ALPHABET[combined & 63];
	}
	return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}

function requiredGetter(prototype: object, name: string): (this: object) => unknown {
	const getter = Object.getOwnPropertyDescriptor(prototype, name)?.get;
	if (!getter) throw new Error(`Missing intrinsic ${name} getter.`);
	return getter;
}

function intrinsicByteLength(getter: (this: object) => unknown, value: object): number {
	const byteLength = Reflect.apply(getter, value, []) as unknown;
	if (!Number.isSafeInteger(byteLength) || Number(byteLength) < 0) {
		throw new RangeError('An opaque binary value has an invalid byte length.');
	}
	return Number(byteLength);
}
