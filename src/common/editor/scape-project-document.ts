/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	isProjectSchemaFamily,
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
	type ProjectSchemaFamily,
} from './project-schema-identity.ts';
import {
	preflightScapeProjectJsonStructure,
	type ScapeProjectJsonStructureLimits,
} from './scape-project-json-preflight.ts';
import { projectDeclaresScapeLiteralKeys, validateScapeLiteralKeys, restoreScapeLiteralKeys } from './scape-literal-json-keys.ts';

import {
	BASE64_ALPHABET,
	BINARY_DESCRIPTOR_SCHEMA_VERSION,
	BINARY_TAG,
	OMIT,
	admitBinary,
	admitTraversal,
	assertChildrenFitTraversal,
	encodeScapeProjectDocumentValue,
	materializeScapeProjectJsonTokens,
	serializeScapeProjectJsonTokens,
	type ScapeProjectJsonToken,
	type BinaryDescriptor,
} from './scape-project-document-encode.ts';

const MIB = 1024 * 1024;
const BINARY_TAG_JSON_NODE_OVERHEAD = 6;
const BINARY_TAG_JSON_DEPTH_OVERHEAD = 2;

export interface ScapeProjectBinaryLimits {
	readonly maximumPayloadCount: number;
	readonly maximumPayloadBytes: number;
	readonly maximumTotalPayloadBytes: number;
	readonly maximumTraversalNodes: number;
	readonly maximumTraversalDepth: number;
}

export interface ScapeProjectDocumentOptions {
	/** When supplied, another known product family remains completely opaque. */
	readonly currentProjectSchemaFamily?: ProjectSchemaFamily;
	readonly limits?: Partial<ScapeProjectBinaryLimits>;
}

export const SCAPE_PROJECT_BINARY_HARD_LIMITS: Readonly<ScapeProjectBinaryLimits> = Object.freeze({
	maximumPayloadCount: 256,
	maximumPayloadBytes: 4 * MIB,
	maximumTotalPayloadBytes: 8 * MIB,
	maximumTraversalNodes: 100_000,
	maximumTraversalDepth: 128,
});

export const SCAPE_PROJECT_JSON_STRUCTURE_HARD_LIMITS: Readonly<
	ScapeProjectJsonStructureLimits
> = Object.freeze(jsonStructureLimits(SCAPE_PROJECT_BINARY_HARD_LIMITS));

interface DecodeBudget {
	readonly limits: Readonly<ScapeProjectBinaryLimits>;
	readonly ids: Set<number>;
	nodes: number;
	payloadCount: number;
	totalPayloadBytes: number;
}

type Container = Record<string, unknown> | unknown[];

interface LocatedBinaryDescriptor {
	readonly parent: Container;
	readonly key: string | number;
	readonly descriptor: BinaryDescriptor;
}

interface DecodeTraversal {
	readonly value: unknown;
	readonly parent: Container | null;
	readonly key: string | number | null;
	readonly depth: number;
}

export function resolveScapeProjectBinaryLimits(
	overrides: Partial<ScapeProjectBinaryLimits> = {},
): Readonly<ScapeProjectBinaryLimits> {
	if (!isPlainObject(overrides)) {
		throw new TypeError('Scape project binary limits must be an object.');
	}
	for (const name of Object.keys(overrides)) {
		if (!Object.hasOwn(SCAPE_PROJECT_BINARY_HARD_LIMITS, name)) {
			throw new TypeError(`Unsupported Scape project binary limit: ${name}.`);
		}
	}
	const limits = { ...SCAPE_PROJECT_BINARY_HARD_LIMITS, ...overrides };
	for (const name of Object.keys(
		SCAPE_PROJECT_BINARY_HARD_LIMITS,
	) as (keyof ScapeProjectBinaryLimits)[]) {
		const value = limits[name];
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError(`Scape project binary ${name} must be a positive safe integer.`);
		}
		if (value > SCAPE_PROJECT_BINARY_HARD_LIMITS[name]) {
			throw new RangeError(`Scape project binary ${name} cannot exceed its hard limit.`);
		}
	}
	return Object.freeze(limits);
}

export function serializeScapeProjectDocument(
	value: unknown,
	options: ScapeProjectDocumentOptions = {},
): string {
	const limits = resolveOptions(options);
	if (!hasBaselineProjectIdentity(value, options.currentProjectSchemaFamily)) return ordinaryJson(value);
	const encoded = encodeScapeProjectDocumentValue(value, limits, undefined, projectDeclaresScapeLiteralKeys(value));
	if (encoded === OMIT) throw new TypeError('The Scape project cannot be serialized.');
	return ordinaryJson(encoded);
}

/** Compare the exact serializer output without reconstructing two encoded trees. */
export function sameSerializedScapeProjectDocument(
	left: unknown,
	right: unknown,
	options: ScapeProjectDocumentOptions = {},
): boolean {
	const first = captureScapeProjectJson(left, options);
	const second = captureScapeProjectJson(right, options);
	if (first.serialized || second.serialized) {
		return serializeScapeProjectJsonTokens(first.tokens) === serializeScapeProjectJsonTokens(second.tokens);
	}
	return first.tokens.length === second.tokens.length
		&& first.tokens.every((token, index) => token === second.tokens[index]);
}

function captureScapeProjectJson(value: unknown, options: ScapeProjectDocumentOptions) {
	const limits = resolveOptions(options);
	const tokens: ScapeProjectJsonToken[] = [];
	let serialized = false;
	if (!hasBaselineProjectIdentity(value, options.currentProjectSchemaFamily)) {
		tokens.push({ serialized: ordinaryJson(value) });
		return { tokens, serialized: true };
	}
	const encoded = encodeScapeProjectDocumentValue(value, limits, (token) => {
		tokens.push(token);
		if (token && typeof token === 'object') serialized = true;
	}, projectDeclaresScapeLiteralKeys(value));
	if (encoded === OMIT) throw new TypeError('The Scape project cannot be serialized.');
	// Hooks may be installed by ordinary left inputs or during baseline Proxy
	// traversal. Reconstruct the detached tree without revisiting either source.
	if (Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')
		|| Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')) {
		return { tokens: [{ serialized: ordinaryJson(materializeScapeProjectJsonTokens(tokens)) }], serialized: true };
	}
	// Binary descriptors and reordered Proxy subtrees must be serialized after
	// traversal, matching the ordinary serializer's hook timing and ownership.
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token && typeof token === 'object' && 'encoded' in token) {
			tokens[index] = { serialized: ordinaryJson(token.encoded) };
		}
	}
	return { tokens, serialized };
}

export function parseScapeProjectDocument(
	text: string,
	options: ScapeProjectDocumentOptions = {},
): unknown {
	const { limits, parsed } = parseOpaqueProjectDocument(text, options);
	if (!hasBaselineProjectIdentity(parsed, options.currentProjectSchemaFamily)) return parsed;
	decodeCurrentProject(parsed, limits);
	return parsed;
}

/** Parse bounded inert JSON without activating any family-owned binary extension. */
export function parseOpaqueScapeProjectDocument(
	text: string,
	options: ScapeProjectDocumentOptions = {},
): unknown {
	return parseOpaqueProjectDocument(text, options).parsed;
}

function parseOpaqueProjectDocument(
	text: string,
	options: ScapeProjectDocumentOptions,
): Readonly<{ limits: Readonly<ScapeProjectBinaryLimits>; parsed: unknown }> {
	if (typeof text !== 'string') throw new TypeError('The Scape project document must be JSON text.');
	const limits = resolveOptions(options);
	preflightScapeProjectJsonStructure(text, jsonStructureLimits(limits));
	return { limits, parsed: JSON.parse(text) as unknown };
}

function jsonStructureLimits(
	limits: Readonly<ScapeProjectBinaryLimits>,
): Readonly<ScapeProjectJsonStructureLimits> {
	return {
		maximumTraversalNodes: limits.maximumTraversalNodes
			+ limits.maximumPayloadCount * BINARY_TAG_JSON_NODE_OVERHEAD,
		maximumTraversalDepth: limits.maximumTraversalDepth + BINARY_TAG_JSON_DEPTH_OVERHEAD,
	};
}

function resolveOptions(options: ScapeProjectDocumentOptions): Readonly<ScapeProjectBinaryLimits> {
	if (!isPlainObject(options)) throw new TypeError('Scape project document options must be an object.');
	for (const name of Object.keys(options)) {
		if (name !== 'limits' && name !== 'currentProjectSchemaFamily') {
			throw new TypeError(`Unsupported Scape project document option: ${name}.`);
		}
	}
	if (options.currentProjectSchemaFamily !== undefined
		&& !isProjectSchemaFamily(options.currentProjectSchemaFamily)) {
		throw new TypeError('The current Scape project schema family is unsupported.');
	}
	return resolveScapeProjectBinaryLimits(options.limits ?? {});
}

function ordinaryJson(value: unknown): string {
	const text = JSON.stringify(value);
	if (typeof text !== 'string') throw new TypeError('The Scape project cannot be serialized.');
	return text;
}

function hasBaselineProjectIdentity(
	value: unknown,
	currentFamily?: ProjectSchemaFamily,
): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	if (!Object.getOwnPropertyDescriptor(value, 'schemaFamily')) return false;
	const identity = readProjectSchemaIdentity(value);
	if (identity.schemaVersion !== PROJECT_SCHEMA_VERSION
		|| (currentFamily !== undefined && identity.schemaFamily !== currentFamily)) return false;
	if (!isPlainObject(value)) {
		throw new TypeError('A baseline Scape project must be a plain object.');
	}
	return true;
}

function enumerableData(value: unknown): PropertyDescriptor {
	return { value, enumerable: true, configurable: true, writable: true };
}

function decodeCurrentProject(
	project: Record<string, unknown>,
	limits: Readonly<ScapeProjectBinaryLimits>,
): void {
	const budget: DecodeBudget = {
		limits,
		ids: new Set(),
		nodes: 0,
		payloadCount: 0,
		totalPayloadBytes: 0,
	};
	const located: LocatedBinaryDescriptor[] = [];
	const literalObjects: Record<string, unknown>[] = [];
	const literalKeys = projectDeclaresScapeLiteralKeys(project);
	const stack: DecodeTraversal[] = [];
	scheduleDecode(stack, { value: project, parent: null, key: null, depth: 0 }, budget);
	while (stack.length) {
		const current = stack.pop();
		if (!current) continue;
		if (!current.value || typeof current.value !== 'object') continue;
		if (Array.isArray(current.value)) {
			assertChildrenFitTraversal(current.value.length, budget);
			for (let index = current.value.length - 1; index >= 0; index -= 1) {
				scheduleDecode(stack, {
					value: current.value[index],
					parent: current.value,
					key: index,
					depth: current.depth + 1,
				}, budget);
			}
			continue;
		}
		const object = current.value as Record<string, unknown>;
		if (Object.hasOwn(object, BINARY_TAG)) {
			if (!current.parent || current.key === null) {
				throw new TypeError('The Scape project root cannot be a binary tag.');
			}
			const descriptor = validateBinaryTag(object, budget);
			located.push({ parent: current.parent, key: current.key, descriptor });
			continue;
		}
		const keys = Object.keys(object);
		if (literalKeys && validateScapeLiteralKeys(object)) literalObjects.push(object);
		assertChildrenFitTraversal(keys.length, budget);
		for (let index = keys.length - 1; index >= 0; index -= 1) {
			const key = keys[index];
			if (key === undefined) continue;
			scheduleDecode(stack, {
				value: object[key],
				parent: object,
				key,
				depth: current.depth + 1,
			}, budget);
		}
	}
	for (const item of located) {
		const bytes = decodeBase64(item.descriptor.base64, item.descriptor.byteLength);
		const value = item.descriptor.type === 'ArrayBuffer' ? bytes.buffer : bytes;
		Object.defineProperty(item.parent, item.key, enumerableData(value));
	}
	for (const object of literalObjects) restoreScapeLiteralKeys(object);
}

function scheduleDecode(
	stack: DecodeTraversal[],
	item: DecodeTraversal,
	budget: DecodeBudget,
): void {
	admitTraversal(item.depth, budget);
	stack.push(item);
}

function validateBinaryTag(
	outer: Record<string, unknown>,
	budget: DecodeBudget,
): BinaryDescriptor {
	if (Object.keys(outer).length !== 1) {
		throw new TypeError(`The reserved ${BINARY_TAG} tag cannot have sibling fields.`);
	}
	const candidate = outer[BINARY_TAG];
	if (!isPlainObject(candidate)) throw new TypeError('A Scape opaque binary descriptor must be an object.');
	const expectedKeys = ['schemaVersion', 'id', 'type', 'byteLength', 'base64'];
	const keys = Object.keys(candidate);
	if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) {
		throw new TypeError('A Scape opaque binary descriptor has unknown or missing fields.');
	}
	if (candidate.schemaVersion !== BINARY_DESCRIPTOR_SCHEMA_VERSION) {
		throw new RangeError('Unsupported Scape opaque binary descriptor schema version.');
	}
	if (!Number.isSafeInteger(candidate.id) || Number(candidate.id) < 1) {
		throw new RangeError('A Scape opaque binary descriptor ID must be a positive safe integer.');
	}
	const id = Number(candidate.id);
	if (budget.ids.has(id)) throw new TypeError(`Duplicate Scape opaque binary descriptor ID: ${String(id)}.`);
	if (candidate.type !== 'Uint8Array' && candidate.type !== 'ArrayBuffer') {
		throw new TypeError('Unsupported Scape opaque binary descriptor type.');
	}
	if (!Number.isSafeInteger(candidate.byteLength) || Number(candidate.byteLength) < 0) {
		throw new RangeError('A Scape opaque binary byte length must be a safe non-negative integer.');
	}
	if (typeof candidate.base64 !== 'string') {
		throw new TypeError('Scape opaque binary base64 must be a string.');
	}
	const byteLength = Number(candidate.byteLength);
	validateCanonicalBase64(candidate.base64, byteLength);
	admitBinary(byteLength, budget);
	budget.ids.add(id);
	return {
		schemaVersion: BINARY_DESCRIPTOR_SCHEMA_VERSION,
		id,
		type: candidate.type,
		byteLength,
		base64: candidate.base64,
	};
}

function validateCanonicalBase64(value: string, expectedBytes: number): void {
	if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
		throw new TypeError('Scape opaque binary base64 is malformed.');
	}
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	const byteLength = value.length / 4 * 3 - padding;
	if (byteLength !== expectedBytes) {
		throw new RangeError('Scape opaque binary base64 does not match its declared byte length.');
	}
	if (!value.length) return;
	if (padding === 2) {
		const index = BASE64_ALPHABET.indexOf(value[value.length - 3] ?? '');
		if (index < 0 || (index & 0x0f) !== 0) throw new TypeError('Scape opaque binary base64 is noncanonical.');
	} else if (padding === 1) {
		const index = BASE64_ALPHABET.indexOf(value[value.length - 2] ?? '');
		if (index < 0 || (index & 0x03) !== 0) throw new TypeError('Scape opaque binary base64 is noncanonical.');
	}
}

function decodeBase64(value: string, byteLength: number): Uint8Array {
	const output = new Uint8Array(byteLength);
	let offset = 0;
	for (let index = 0; index < value.length; index += 4) {
		const first = BASE64_ALPHABET.indexOf(value[index] ?? '');
		const second = BASE64_ALPHABET.indexOf(value[index + 1] ?? '');
		const third = value[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 2] ?? '');
		const fourth = value[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(value[index + 3] ?? '');
		const combined = (first << 18) | (second << 12) | (third << 6) | fourth;
		if (offset < output.length) output[offset++] = combined >>> 16;
		if (offset < output.length) output[offset++] = combined >>> 8;
		if (offset < output.length) output[offset++] = combined;
	}
	return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
