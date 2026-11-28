/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDigest as createScapeDigest, digestBytes as digestScapeBytes, hex as scapeHex } from '../media/bytes.ts';
import { portableFileStem } from './portable-file-stem.ts';

/**
 * Project archive checksum manifests record each member's byte length and
 * SHA-256 digest. Members are sorted by ID, and the caller supplies the
 * timestamp so serialization yields deterministic bytes.
 */

export const ARCHIVE_MANIFEST_VERSION = 1;

export interface ArchiveManifestMember {
	readonly id: string;
	/** Where the member lives inside the archive. */
	readonly path: string;
	readonly byteLength: number;
	readonly sha256: string;
	/** What the project refers to this by, when that differs from the path. */
	readonly sourceId?: string | null;
}

export interface ArchiveManifest {
	readonly manifestVersion: typeof ARCHIVE_MANIFEST_VERSION;
	readonly kind: 'archive-manifest';
	readonly generatedAt: string | null;
	readonly projectTitle: string | null;
	readonly members: readonly ArchiveManifestMember[];
	readonly totalByteLength: number;
}

export interface ArchiveManifestContext {
	/** ISO-8601 instant, supplied so the document stays deterministic. */
	readonly generatedAt?: string | null;
	readonly projectTitle?: string | null;
}

export interface ArchiveMemberInput {
	readonly id: string;
	readonly path?: string;
	readonly sourceId?: string | null;
	readonly bytes: Uint8Array;
}

/** Build a manifest by digesting each member. Never trusts a caller-supplied digest. */
export function createArchiveManifest(
	members: readonly ArchiveMemberInput[],
	context: ArchiveManifestContext = {},
): ArchiveManifest {
	const seen = new Set<string>();
	const entries: ArchiveManifestMember[] = [];
	for (const member of members ?? []) {
		const id = admitMemberId(member?.id, seen);
		if (!(member.bytes instanceof Uint8Array)) {
			throw new TypeError(`Archive member ${id} must supply its bytes to be digested.`);
		}
		entries.push(Object.freeze({
			id,
			path: String(member.path ?? id),
			byteLength: member.bytes.byteLength,
			// Digested here rather than accepted from the caller: a manifest that
			// repeats a digest it was handed proves only that it was handed one.
			sha256: digestScapeBytes(member.bytes),
			sourceId: member.sourceId ?? null,
		}));
	}
	return assembleArchiveManifest(entries, context);
}

export interface ArchiveMemberStreamInput {
	readonly id: string;
	readonly path?: string;
	readonly sourceId?: string | null;
	/** The member's bytes, in order. Digested as they arrive and never retained. */
	readonly chunks: AsyncIterable<Uint8Array>;
}

/**
 * The same manifest, for members too large to hold.
 *
 * A reference-scale archive member does not fit in memory, and a manifest
 * builder that demanded one would be unusable at exactly the scale the archive
 * exists for. The rule that matters is unchanged: the digest is computed here,
 * from the bytes as they go past, and never accepted from a caller.
 */
export async function createArchiveManifestFromStreams(
	members: AsyncIterable<ArchiveMemberStreamInput> | Iterable<ArchiveMemberStreamInput>,
	context: ArchiveManifestContext = {},
): Promise<ArchiveManifest> {
	const seen = new Set<string>();
	const entries: ArchiveManifestMember[] = [];
	for await (const member of members) {
		const id = admitMemberId(member?.id, seen);
		const digest = createScapeDigest();
		let byteLength = 0;
		for await (const chunk of member.chunks) {
			if (!(chunk instanceof Uint8Array)) {
				throw new TypeError(`Archive member ${id} emitted a non-byte chunk.`);
			}
			digest.update(chunk);
			byteLength += chunk.byteLength;
		}
		entries.push(Object.freeze({
			id,
			path: String(member.path ?? id),
			byteLength,
			sha256: scapeHex(digest.digest()),
			sourceId: member.sourceId ?? null,
		}));
	}
	return assembleArchiveManifest(entries, context);
}

function admitMemberId(value: unknown, seen: Set<string>): string {
	const id = nonEmpty(value, 'member id');
	if (seen.has(id)) throw new RangeError(`Archive member ${id} is listed twice.`);
	seen.add(id);
	return id;
}

function assembleArchiveManifest(
	entries: ArchiveManifestMember[],
	context: ArchiveManifestContext,
): ArchiveManifest {
	entries.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
	return Object.freeze({
		manifestVersion: ARCHIVE_MANIFEST_VERSION,
		kind: 'archive-manifest' as const,
		generatedAt: nonEmptyOrNull(context.generatedAt),
		projectTitle: nonEmptyOrNull(context.projectTitle),
		members: Object.freeze(entries),
		totalByteLength: entries.reduce((sum, entry) => sum + entry.byteLength, 0),
	});
}

export interface SerializedArchiveManifest {
	readonly text: string;
	readonly fileName: string;
	readonly mimeType: 'application/json';
}

export function serializeArchiveManifest(manifest: ArchiveManifest): SerializedArchiveManifest {
	if (!manifest || manifest.kind !== 'archive-manifest') {
		throw new TypeError('An archive manifest is required.');
	}
	const document = {
		manifestVersion: manifest.manifestVersion,
		kind: manifest.kind,
		generatedAt: manifest.generatedAt,
		projectTitle: manifest.projectTitle,
		totalByteLength: manifest.totalByteLength,
		members: manifest.members.map((member) => ({
			id: member.id,
			path: member.path,
			sourceId: member.sourceId,
			byteLength: member.byteLength,
			sha256: member.sha256,
		})),
	};
	return Object.freeze({
		text: `${JSON.stringify(document, null, '\t')}\n`,
		fileName: manifestFileName(manifest),
		mimeType: 'application/json' as const,
	});
}

export function parseArchiveManifest(text: string): ArchiveManifest {
	const parsed = JSON.parse(String(text)) as Record<string, unknown>;
	if (parsed?.kind !== 'archive-manifest') throw new TypeError('This document is not an archive manifest.');
	if (parsed.manifestVersion !== ARCHIVE_MANIFEST_VERSION) {
		throw new RangeError(`Unsupported archive manifest version: ${String(parsed.manifestVersion)}.`);
	}
	const members = (Array.isArray(parsed.members) ? parsed.members : []).map((entry) => {
		const member = entry as Record<string, unknown>;
		return Object.freeze({
			id: nonEmpty(member.id, 'member id'),
			path: String(member.path ?? member.id),
			byteLength: nonNegativeInteger(member.byteLength, 'member byteLength'),
			sha256: nonEmpty(member.sha256, 'member sha256'),
			sourceId: member.sourceId == null ? null : String(member.sourceId),
		});
	});
	return Object.freeze({
		manifestVersion: ARCHIVE_MANIFEST_VERSION,
		kind: 'archive-manifest' as const,
		generatedAt: nonEmptyOrNull(parsed.generatedAt),
		projectTitle: nonEmptyOrNull(parsed.projectTitle),
		members: Object.freeze(members),
		totalByteLength: nonNegativeInteger(parsed.totalByteLength ?? 0, 'totalByteLength'),
	});
}

/** Save through the reserved `'report'` purpose, as the delivery report does. */
export async function saveArchiveManifest(
	manifest: ArchiveManifest,
	fileService: { saveFile?: (request: Readonly<Record<string, unknown>>) => unknown } | null | undefined,
): Promise<SerializedArchiveManifest & Readonly<{ cancelled?: true }>> {
	const serialized = serializeArchiveManifest(manifest);
	if (fileService?.saveFile) {
		const saved = await fileService.saveFile({
			purpose: 'report',
			suggestedName: serialized.fileName,
			mimeType: serialized.mimeType,
			blob: new Blob([serialized.text], { type: serialized.mimeType }),
		});
		if (saved !== null && typeof saved === 'object' && 'cancelled' in saved && saved.cancelled === true) {
			return Object.freeze({ ...serialized, cancelled: true });
		}
	}
	return serialized;
}

function manifestFileName(manifest: ArchiveManifest): string {
	const title = portableFileStem(manifest.projectTitle, 'project');
	const stamp = portableFileStem((manifest.generatedAt ?? '').slice(0, 10));
	return stamp ? `${title}-archive-manifest-${stamp}.json` : `${title}-archive-manifest.json`;
}

function nonEmpty(value: unknown, label: string): string {
	const text = String(value ?? '').trim();
	if (!text) throw new TypeError(`An archive ${label} is required.`);
	return text;
}

function nonEmptyOrNull(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value: unknown, label: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer.`);
	}
	return number;
}
