/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDigest, digestBytes, hex } from '../common/media/bytes.ts';
import { awaitScapeOperation } from '../common/scape/abort.ts';
import { verifyScapeAssetBytes, verifyScapeExtractedAsset } from '../common/scape/asset-bytes.ts';
import type { ScapeArchiveEntry } from '../common/scape/archive-envelope.ts';
import { readScapeArchiveEnvelope } from '../common/editor/scape-archive-envelope.ts';
import type { ScapeArchiveLimits } from '../common/scape/archive-limits.ts';
import type { ScapeArchiveReaderFactory, ScapeArchiveByteSourceReaderFactory } from '../common/editor/scape-archive-reader.ts';
import { isDesktopScapeArchiveByteSource } from '../common/editor/desktop-scape-archive-byte-source.ts';
import { parseScapeProjectDocument, serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { withScapeProjectInput, type ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { classifyProjectSchemaIdentity } from '../common/editor/project-schema-identity.ts';
import { createProjectCopyDocument } from '../common/editor/storage/project-copy-document.ts';
import { createStableId } from '../common/editor/project.js';
import type { ProjectRecoveryChange } from '../common/editor/project-recovery-reason.ts';
import type { FileSizeWarningOptions } from '../common/editor/controller/shared/file-size-warning.ts';
import { isProjectOpenRecoveryBlocked } from '../common/editor/controller/document/project-open-recovery.ts';
import type { ScapeProjectAssetExtension } from '../common/editor/scape-project-asset-extension.ts';
import { repairSoundscaperProject } from './editor-project-recovery-repair.ts';

export interface SoundscaperScapeRecoveryOptions extends FileSizeWarningOptions {
	readonly signal?: AbortSignal;
	readonly archiveLimits?: Partial<ScapeArchiveLimits>;
	readonly archiveReaderFactory?: ScapeArchiveReaderFactory;
	readonly archiveByteSourceReaderFactory?: ScapeArchiveByteSourceReaderFactory;
	readonly projectAssetExtension?: ScapeProjectAssetExtension;
}

const encoder = new TextEncoder();
const mediaKinds = new Set(['audio', 'video', 'video-timing']);

/** Reuse strict archive admission and import. Only verified media enters a fresh repaired document. */
export async function recoverSoundscaperScape<Result>(
	input: ScapeProjectInput,
	options: SoundscaperScapeRecoveryOptions,
	consume: (input: Blob, overrides: Readonly<{ archiveReaderFactory: ScapeArchiveReaderFactory; collision: 'copy' }>) => Promise<Result>,
): Promise<(Result & { readonly recoveryChanges: readonly ProjectRecoveryChange[] }) | null> {
	const signal = options.signal;
	return withScapeProjectInput(input, signal, async (entries) => {
		const envelope = await readScapeArchiveEnvelope(entries, options.archiveLimits, signal,
			options.projectAssetExtension?.assetKinds, isDesktopScapeArchiveByteSource(input), options, undefined, { missingAssetKinds: [...mediaKinds] });
		verifyScapeAssetBytes(encoder.encode(envelope.projectText), envelope.manifest.project, 'project document');
		const original = parseScapeProjectDocument(envelope.projectText, { currentProjectSchemaFamily: 'soundscaper' });
		if (classifyProjectSchemaIdentity(original, 'soundscaper').disposition !== 'current') return null;
		const available = new Set<string>();
		const unavailable = new Set<string>();
		for (const asset of envelope.manifest.assets) {
			signal?.throwIfAborted();
			const entry = envelope.entryByName.get(asset.entry);
			if (!entry?.getData) throw new Error('The recovery archive contains an unreadable entry.');
			const digest = createDigest();
			let size = 0, budgetFailure = false;
			try {
				await awaitScapeOperation(entry.getData(new WritableStream<Uint8Array>({ write(bytes) {
					signal?.throwIfAborted();
					try {
						envelope.expandedByteBudget.consume(bytes.byteLength, asset.entry);
						if (bytes.byteLength > asset.size - size) throw new RangeError('A recovery asset exceeds its declared size.');
					} catch (error) { budgetFailure = true; throw error; }
					size += bytes.byteLength; digest.update(bytes);
				} }), { signal, strictness: 'strict', checkOverlappingEntry: true }), signal);
				verifyScapeExtractedAsset(asset, hex(digest.digest()), size, asset.entry);
				available.add(asset.sourceId);
			} catch (error) {
				signal?.throwIfAborted();
				if (budgetFailure || isProjectOpenRecoveryBlocked(error) || !mediaKinds.has(asset.kind)) throw error;
				unavailable.add(asset.sourceId);
			}
		}
		for (const id of unavailable) available.delete(id);
		if (original && typeof original === 'object' && 'sources' in original && Array.isArray(original.sources)) {
			const sources: readonly unknown[] = original.sources;
			for (const value of sources) {
				const key = videoTimingKey(value);
				if (key && !available.has(key) && value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
					available.delete(value.id);
				}
			}
		}
		const repaired = repairSoundscaperProject(original, available);
		if (!repaired.changes.length) return null;
		const project = createProjectCopyDocument(repaired.project, {
			id: createStableId('project'), title: `${repaired.project.title} (recovered)`, timestamp: new Date().toISOString(),
		});
		const projectBytes = encoder.encode(serializeScapeProjectDocument(project));
		const retained = new Set(repaired.project.sources.map(({ id }) => id));
		const timingKeys = new Set(repaired.project.sources.map(videoTimingKey).filter((key) => key !== null));
		const assets = envelope.manifest.assets.filter((asset) => asset.kind === 'video-timing'
			? timingKeys.has(asset.sourceId) : !mediaKinds.has(asset.kind) || retained.has(asset.sourceId));
		const manifest = { ...envelope.manifest, assets,
			project: { ...envelope.manifest.project, size: projectBytes.byteLength, sha256: digestBytes(projectBytes) } };
		const names = new Set(assets.map(({ entry }) => entry));
		const recoveredEntries = entries.filter(({ filename }) => names.has(filename));
		recoveredEntries.push(textEntry('project.json', projectBytes), textEntry('manifest.json', encoder.encode(JSON.stringify(manifest))));
		const archiveReaderFactory: ScapeArchiveReaderFactory = () => ({
			async *getEntriesGenerator() { yield* recoveredEntries; return true; },
			async close() {},
		});
		const result = await consume(new Blob(), { archiveReaderFactory, collision: 'copy' });
		return Object.freeze({ ...result, recoveryChanges: repaired.changes });
	}, { blob: options.archiveReaderFactory, byteSource: options.archiveByteSourceReaderFactory });
}

function videoTimingKey(value: unknown): string | null {
	if (!value || typeof value !== 'object' || !('kind' in value) || value.kind !== 'video' || !('timingAsset' in value)) return null;
	const reference = value.timingAsset;
	return reference && typeof reference === 'object' && 'storageKey' in reference && typeof reference.storageKey === 'string'
		? reference.storageKey : null;
}

function textEntry(filename: string, bytes: Uint8Array): ScapeArchiveEntry {
	return { filename, directory: false, encrypted: false, compressionMethod: 0,
		compressedSize: bytes.byteLength, uncompressedSize: bytes.byteLength,
		async getData(writable, options) {
			options?.signal?.throwIfAborted();
			if (options?.checkOverlappingEntryOnly) return;
			const writer = writable.getWriter();
			try { await writer.write(bytes); await writer.close(); }
			finally { writer.releaseLock(); }
		} };
}
