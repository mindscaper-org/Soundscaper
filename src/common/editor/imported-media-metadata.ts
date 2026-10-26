/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectAiffMetadata } from './aiff-imported-metadata.ts';
import { correctImportedRiffMetadata } from './riff-imported-metadata.ts';
import { readImportedMetadataTags } from './imported-metadata-reader.ts';

const MAXIMUM_METADATA_STRING_LENGTH = 65_536;
const MAXIMUM_METADATA_ARRAY_LENGTH = 512;
const MAXIMUM_METADATA_RECORD_KEYS = 1_024;
const MAXIMUM_METADATA_DEPTH = 12;
const MAXIMUM_METADATA_NODES = 8_192;
const MAXIMUM_METADATA_WARNINGS = 256;
const MAXIMUM_METADATA_ATTACHMENTS = 256;
const MAXIMUM_METADATA_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAXIMUM_TOTAL_METADATA_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAXIMUM_METADATA_KEY_LENGTH = 256;
type JsonScalar = string | number | boolean | null;
export type ImportedMediaMetadataValue = JsonScalar
	| readonly ImportedMediaMetadataValue[]
	| ImportedMediaMetadataRecord;

export interface ImportedMediaMetadataRecord {
	readonly [key: string]: ImportedMediaMetadataValue;
}

export interface ImportedMediaMetadataAttachment {
	readonly path: string;
	readonly kind?: string;
	readonly mimeType?: string;
	readonly name?: string;
	readonly description?: string;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface ImportedMediaMetadataInspection {
	readonly metadata: Readonly<{
		readonly normalized?: Readonly<Record<string, ImportedMediaMetadataValue>>;
		readonly raw?: Readonly<Record<string, ImportedMediaMetadataValue>>;
		readonly namespaces?: Readonly<Record<string, ImportedMediaMetadataValue>>;
	}>;
	readonly attachments: readonly ImportedMediaMetadataAttachment[];
	readonly warnings: readonly string[];
}

export type ImportedMediaMetadataReader = (
	file: Blob,
	signal?: AbortSignal,
) => Promise<unknown>;

export interface InspectImportedMediaMetadataOptions {
	readonly signal?: AbortSignal;
	/** Test seam; production lazily loads Mediabunny. */
	readonly readTags?: ImportedMediaMetadataReader;
}

interface CanonicalizationContext {
	readonly attachments: ImportedMediaMetadataAttachment[];
	readonly warnings: string[];
	readonly seen: WeakSet<object>;
	nodes: number;
	attachmentBytes: number;
	nodeLimitReported: boolean;
	attachmentLimitReported: boolean;
}

export async function inspectImportedMediaMetadata(
	file: Blob,
	options: InspectImportedMediaMetadataOptions = {},
): Promise<ImportedMediaMetadataInspection> {
	options.signal?.throwIfAborted();
	try {
		const aiff = options.readTags ? null : await inspectAiffMetadata(file, options.signal);
		options.signal?.throwIfAborted();
		const warnings = [...aiff?.warnings ?? []];
		const tags = await correctImportedRiffMetadata(file, aiff?.tags ?? await (options.readTags ?? readImportedMetadataTags)(file, options.signal), options.signal, (warning) => { if (warnings.length < MAXIMUM_METADATA_WARNINGS) warnings.push(warning); });
		options.signal?.throwIfAborted();
		const inspected = await canonicalizeImportedMediaMetadata(tags, aiff?.namespaces, warnings);
		options.signal?.throwIfAborted();
		return inspected;
	} catch (error) {
		options.signal?.throwIfAborted();
		return Object.freeze({
			metadata: Object.freeze({}),
			attachments: Object.freeze([]),
			warnings: Object.freeze([`Metadata inspection failed: ${errorMessage(error)}`]),
		});
	}
}

export async function canonicalizeImportedMediaMetadata(
	value: unknown,
	namespaces: Readonly<Record<string, unknown>> = {},
	initialWarnings: readonly string[] = [],
): Promise<ImportedMediaMetadataInspection> {
	const tags = dataRecord(value);
	if (!tags) throw new TypeError('Media metadata tags must be a data record.');
	const context: CanonicalizationContext = {
		attachments: [],
		warnings: [],
		seen: new WeakSet<object>(),
		nodes: 3,
		attachmentBytes: 0,
		nodeLimitReported: false,
		attachmentLimitReported: false,
	};
	for (const warning of initialWarnings) pushWarning(context, warning);
	const normalized: Record<string, ImportedMediaMetadataValue> = {};
	const normalizedKeys = Object.keys(tags).filter((key) => key !== 'raw' && key !== 'images').sort();
	if (normalizedKeys.length > MAXIMUM_METADATA_RECORD_KEYS) {
		pushWarning(context, `Normalized metadata exceeded ${String(MAXIMUM_METADATA_RECORD_KEYS)} entries and was truncated.`);
	}
	for (const key of normalizedKeys.slice(0, MAXIMUM_METADATA_RECORD_KEYS)) {
		if (!validMetadataKey(key, 'normalized', context)) continue;
		const candidate = ownDataValue(tags, key);
		if (candidate === undefined) continue;
		const canonical = canonicalValue(candidate, `normalized.${key}`, context, 0);
		if (canonical !== undefined) defineRecordValue(normalized, key, canonical);
	}
	const images = Array.isArray(ownDataValue(tags, 'images')) ? ownDataValue(tags, 'images') as unknown[] : [];
	if (images.length > MAXIMUM_METADATA_ARRAY_LENGTH) {
		pushWarning(context, `Metadata images exceeded ${String(MAXIMUM_METADATA_ARRAY_LENGTH)} entries and were truncated.`);
	}
	for (let index = 0; index < Math.min(images.length, MAXIMUM_METADATA_ARRAY_LENGTH); index += 1) {
		await describeBinaryValue(images[index], `images[${String(index)}]`, context);
	}
	const raw = await canonicalizeRawTags(ownDataValue(tags, 'raw'), context);
	const canonicalNamespaces = canonicalValue(namespaces, 'namespaces', context, 0);
	const namespaceRecord = isMetadataRecord(canonicalNamespaces) ? canonicalNamespaces : undefined;
	return Object.freeze({
		metadata: Object.freeze({
			...(Object.keys(normalized).length ? { normalized: Object.freeze(normalized) } : {}),
			...(raw && Object.keys(raw).length ? { raw: Object.freeze(raw) } : {}),
			...(namespaceRecord && Object.keys(namespaceRecord).length
				? { namespaces: Object.freeze(namespaceRecord) }
				: {}),
		}),
		attachments: Object.freeze(context.attachments),
		warnings: Object.freeze(context.warnings),
	});
}

async function canonicalizeRawTags(
	value: unknown,
	context: CanonicalizationContext,
): Promise<Record<string, ImportedMediaMetadataValue> | undefined> {
	const record = dataRecord(value);
	if (!record) return undefined;
	const output: Record<string, ImportedMediaMetadataValue> = {};
	for (const key of Object.keys(record).sort().slice(0, MAXIMUM_METADATA_RECORD_KEYS)) {
		if (!validMetadataKey(key, 'raw', context)) continue;
		const candidate = ownDataValue(record, key);
		const path = `raw.${key}`;
		const attachment = await describeBinaryValue(candidate, path, context);
		if (attachment) {
			if (!reserveMetadataNodes(context, 2)) continue;
			defineRecordValue(output, key, Object.freeze({ attachmentPath: attachment.path }));
			continue;
		}
		const canonical = canonicalValue(candidate, path, context, 0);
		if (canonical !== undefined) defineRecordValue(output, key, canonical);
	}
	if (Object.keys(record).length > MAXIMUM_METADATA_RECORD_KEYS) {
		pushWarning(context, `Raw metadata exceeded ${String(MAXIMUM_METADATA_RECORD_KEYS)} entries and was truncated.`);
	}
	return output;
}

async function describeBinaryValue(
	value: unknown,
	path: string,
	context: CanonicalizationContext,
): Promise<ImportedMediaMetadataAttachment | null> {
	const record = dataRecord(value);
	const bytes = value instanceof Uint8Array
		? value
		: ownDataValue(record, 'data') instanceof Uint8Array
			? ownDataValue(record, 'data') as Uint8Array
			: null;
	if (!bytes) return null;
	if (context.attachments.length >= MAXIMUM_METADATA_ATTACHMENTS) {
		if (!context.attachmentLimitReported) {
			context.attachmentLimitReported = true;
			pushWarning(context, `Binary metadata exceeded ${String(MAXIMUM_METADATA_ATTACHMENTS)} attachments and was truncated.`);
		}
		return null;
	}
	const byteLength = bytes.byteLength;
	const exceededBudget = byteLength > MAXIMUM_METADATA_ATTACHMENT_BYTES
		? ['per-attachment', MAXIMUM_METADATA_ATTACHMENT_BYTES] as const
		: byteLength > MAXIMUM_TOTAL_METADATA_ATTACHMENT_BYTES - context.attachmentBytes
			? ['aggregate', MAXIMUM_TOTAL_METADATA_ATTACHMENT_BYTES] as const : null;
	if (exceededBudget) {
		pushWarning(context, `${path} binary metadata attachment was ${String(byteLength)} bytes; the ${exceededBudget[0]} limit of ${String(exceededBudget[1])} bytes omitted it.`);
		return null;
	}
	const mimeType = boundedAttachmentText(
		stringValue(ownDataValue(record, 'mimeType')) ?? 'application/octet-stream',
		256,
		`${path}.mimeType`,
		context,
	);
	const name = boundedOptionalAttachmentText(ownDataValue(record, 'name'), `${path}.name`, context);
	const description = boundedOptionalAttachmentText(
		ownDataValue(record, 'description'), `${path}.description`, context,
	);
	const kindValue = stringValue(ownDataValue(record, 'kind'));
	const kind = kindValue
		? boundedAttachmentText(kindValue, MAXIMUM_METADATA_KEY_LENGTH, `${path}.kind`, context) : undefined;
	const descriptor = Object.freeze({
		path,
		...(kind ? { kind } : {}),
		mimeType,
		...(name ? { name } : {}),
		...(description ? { description } : {}),
		byteLength,
		sha256: await sha256Hex(bytes),
	});
	context.attachmentBytes += byteLength;
	context.attachments.push(descriptor);
	return descriptor;
}

function canonicalValue(
	value: unknown,
	path: string,
	context: CanonicalizationContext,
	depth: number,
): ImportedMediaMetadataValue | undefined {
	if (!reserveMetadataNodes(context, 1)) return undefined;
	if (value === undefined) return undefined;
	if (value === null || typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		if (value.length <= MAXIMUM_METADATA_STRING_LENGTH) return value;
		pushWarning(context, `${path} exceeded the metadata string limit and was truncated.`);
		return value.slice(0, MAXIMUM_METADATA_STRING_LENGTH);
	}
	if (typeof value === 'number') {
		if (Number.isFinite(value)) return value;
		pushWarning(context, `${path} contained a non-finite number and was omitted.`);
		return undefined;
	}
	if (typeof value === 'bigint') return value.toString();
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
	if (value instanceof Uint8Array) return undefined;
	if (!value || typeof value !== 'object') return String(value);
	if (depth >= MAXIMUM_METADATA_DEPTH) {
		pushWarning(context, `${path} exceeded the metadata nesting limit and was omitted.`);
		return undefined;
	}
	if (context.seen.has(value)) {
		pushWarning(context, `${path} contained a circular value and was omitted.`);
		return undefined;
	}
	context.seen.add(value);
	try {
		if (Array.isArray(value)) {
			if (value.length > MAXIMUM_METADATA_ARRAY_LENGTH) {
				pushWarning(context, `${path} exceeded the metadata array limit and was truncated.`);
			}
			return Object.freeze(value.slice(0, MAXIMUM_METADATA_ARRAY_LENGTH).flatMap((candidate, index) => {
				const canonical = canonicalValue(candidate, `${path}[${String(index)}]`, context, depth + 1);
				return canonical === undefined ? [] : [canonical];
			}));
		}
		const record = dataRecord(value);
		if (!record) return undefined;
		const output: Record<string, ImportedMediaMetadataValue> = {};
		const keys = Object.keys(record).sort();
		if (keys.length > MAXIMUM_METADATA_RECORD_KEYS) {
			pushWarning(context, `${path} exceeded the metadata record limit and was truncated.`);
		}
		for (const key of keys.slice(0, MAXIMUM_METADATA_RECORD_KEYS)) {
			if (!validMetadataKey(key, path, context)) continue;
			const canonical = canonicalValue(ownDataValue(record, key), `${path}.${key}`, context, depth + 1);
			if (canonical !== undefined) defineRecordValue(output, key, canonical);
		}
		return Object.freeze(output);
	} finally {
		context.seen.delete(value);
	}
}

function reserveMetadataNodes(context: CanonicalizationContext, count: number): boolean {
	context.nodes += count;
	if (context.nodes <= MAXIMUM_METADATA_NODES) return true;
	if (context.nodeLimitReported) return false;
	context.nodeLimitReported = true;
	pushWarning(context, `Metadata exceeded ${String(MAXIMUM_METADATA_NODES)} values and was truncated.`);
	return false;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer));
	return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

function dataRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function isMetadataRecord(value: ImportedMediaMetadataValue | undefined): value is ImportedMediaMetadataRecord {
	return value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object';
}

function ownDataValue(record: Record<string, unknown> | null, key: string): unknown {
	if (!record) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function defineRecordValue(
	record: Record<string, ImportedMediaMetadataValue>,
	key: string,
	value: ImportedMediaMetadataValue,
): void {
	Object.defineProperty(record, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true,
	});
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' && value ? value : undefined;
}

function validMetadataKey(key: string, path: string, context: CanonicalizationContext): boolean {
	if (key.length > 0 && key.length <= MAXIMUM_METADATA_KEY_LENGTH) return true;
	pushWarning(context, `${path} contained an invalid or overlong key and it was omitted.`);
	return false;
}

function boundedOptionalAttachmentText(
	value: unknown,
	path: string,
	context: CanonicalizationContext,
): string | undefined {
	const text = stringValue(value);
	return text ? boundedAttachmentText(text, MAXIMUM_METADATA_STRING_LENGTH, path, context) : undefined;
}

function boundedAttachmentText(
	value: string,
	maximum: number,
	path: string,
	context: CanonicalizationContext,
): string {
	if (value.length <= maximum) return value;
	pushWarning(context, `${path} exceeded the metadata string limit and was truncated.`);
	return value.slice(0, maximum);
}

function pushWarning(context: CanonicalizationContext, warning: string): void {
	if (context.warnings.length < MAXIMUM_METADATA_WARNINGS - 1) {
		context.warnings.push(warning);
		return;
	}
	if (context.warnings.length === MAXIMUM_METADATA_WARNINGS - 1) {
		context.warnings.push('Additional metadata warnings were omitted.');
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : String(error);
}
