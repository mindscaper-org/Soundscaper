/* SPDX-License-Identifier: AGPL-3.0-only */
import { AEP_LIMITS } from '../../aep-container.ts';
import { readNativeAep, type AepFootage } from '../../aep-project-reader.ts';
import { convertNativeAep, aepCanonicalLabel, type NativeAepMediaBinding } from '../../aep-motion-conversion.ts';
import { freezeMotionValue } from '../../motion-values.ts';
import type { MotionAsset } from '../../motion-asset.ts';
import type { MotionImportedMedia, prepareMotionMedia } from '../../motion-media-import.ts';
import type { MotionscaperProject } from '../../motion-project-types.ts';
import { createDigest, digestBytes, hex } from '../../../media/bytes.ts';
import { aggregateScapeErrors } from '../../../scape/abort.ts';
import { readAepText } from '../../aep-text-reader.ts';
import type { NativeAepFontBinding } from '../../aep-motion-text.ts';
export interface NativeAepImportTransaction {
	writeAssetChunk(asset: MotionAsset, bytes: Uint8Array): PromiseLike<void>; finishAsset(asset: MotionAsset): PromiseLike<void>;
	commit(project: MotionscaperProject): PromiseLike<void>; rollback(): PromiseLike<void>;
}
export interface PreparedNativeAepImport {
	readonly project: MotionscaperProject; readonly media: readonly AepFootage[]; readonly fonts: readonly string[];
}
export interface NativeAepImportSelection {
	readonly file: Blob; readonly name: string; readonly primaryCompositionId?: number;
	readonly media?: readonly Readonly<{ sourceId: number; file: Blob; name: string }>[];
	readonly fonts?: readonly Readonly<{ postScriptName: string; file: Blob }>[];
}
export function createNativeAepImportService(ports: Readonly<{
	begin(project: MotionscaperProject): NativeAepImportTransaction | PromiseLike<NativeAepImportTransaction>;
	allocateId?: () => string; prepareMedia?: typeof prepareMotionMedia;
	prepareFont?(body: Blob, id: string, postScriptName: string, signal?: AbortSignal): Promise<Readonly<{ asset: Extract<MotionAsset, { kind: 'font' }>; body: Blob }>>;
}>) {
	const allocateId = ports.allocateId ?? (() => crypto.randomUUID());
	const preparations = new WeakMap<PreparedNativeAepImport, { readonly bodies: readonly MotionImportedMedia[]; state: 'ready' | 'publishing' | 'committed' | 'cleanup-failed'; cleanup?: () => PromiseLike<void> }>();
	return Object.freeze({
		async prepare(selection: NativeAepImportSelection, signal?: AbortSignal): Promise<PreparedNativeAepImport> {
			signal?.throwIfAborted();
			if (!(selection.file instanceof Blob) || selection.file.size < 12 || selection.file.size > AEP_LIMITS.bytes) throw new RangeError('AEP projects are admitted up to 64 MiB.');
			const bytes = new Uint8Array(await selection.file.arrayBuffer()); signal?.throwIfAborted();
			const document = readNativeAep(bytes, signal), sha256 = digestBytes(bytes), source: Extract<MotionAsset, { kind: 'attachment' }> = {
				id: allocateId(), kind: 'attachment', name: aepCanonicalLabel(selection.name, `Original.${document.format}`), mimeType: document.format === 'aep' ? 'application/vnd.adobe.aftereffects.project' : 'application/xml',
				sha256, storageKey: `motion-sha256:${sha256}`, byteLength: bytes.length,
			};
			const bodies: MotionImportedMedia[] = [{ asset: source, body: selection.file }], bindings: NativeAepMediaBinding[] = [], seen = new Set<number>(); let total = bytes.length;
			const fontNames = new Set<string>(), fonts: NativeAepFontBinding[] = [];
			for (const comp of document.compositions) for (const layer of comp.layers) if (layer.kind === 3) {
				try { for (const run of readAepText(layer)?.runs ?? []) fontNames.add(run.font); } catch { /* Conversion review reports unsupported text records. */ }
			}
			if (fontNames.size > 1024) throw new RangeError('AEP font inventory exceeds its face budget.');
			if ((selection.fonts?.length ?? 0) > 1024) throw new RangeError('Too many AEP font selections.');
			for (const selected of selection.fonts ?? []) {
				if (!ports.prepareFont || !fontNames.has(selected.postScriptName) || fonts.some(font => font.postScriptName === selected.postScriptName)) throw new TypeError('Native AEP font selection is unknown or duplicated.');
				if (!(selected.file instanceof Blob) || selected.file.size < 12 || selected.file.size > 16 * 1024 * 1024 || (total += selected.file.size) > 256 * 1024 * 1024) throw new RangeError('AEP font exceeds the 16 MiB font or 256 MiB combined budget.');
				const imported = await ports.prepareFont(selected.file, allocateId(), selected.postScriptName, signal); signal?.throwIfAborted();
				if (imported.asset.kind !== 'font' || imported.body.size !== selected.file.size || imported.asset.byteLength !== selected.file.size) throw new TypeError('AEP font decoder returned inconsistent retained bytes.');
				fonts.push({ postScriptName: selected.postScriptName, asset: imported.asset }); bodies.push(imported);
			}
			if ((selection.media?.length ?? 0) > 4096) throw new RangeError('Too many AEP media selections.');
			for (const selected of selection.media ?? []) {
				signal?.throwIfAborted(); const item = document.footage.find(item => item.id === selected.sourceId);
				if (!item || item.color || item.sequence || seen.has(item.id)) throw new TypeError('AEP media selection is unresolved, a sequence or duplicated.'); seen.add(item.id);
				if (!(selected.file instanceof Blob) || selected.file.size < 1 || selected.file.size > 64 * 1024 * 1024 || (total += selected.file.size) > 256 * 1024 * 1024) throw new RangeError('AEP media exceeds the 64 MiB per-file or 256 MiB combined budget.');
				const decode = ports.prepareMedia ?? (await import('../../motion-media-import.ts')).prepareMotionMedia;
				const imported = await decode(selected.file, { id: allocateId(), name: selected.name, signal }); signal?.throwIfAborted();
				if (!(imported.body instanceof Blob) || imported.body.size !== selected.file.size || imported.asset.byteLength !== selected.file.size) throw new TypeError('AEP media decoder returned inconsistent retained bytes.');
				if (imported.asset.kind === 'font' || imported.asset.kind === 'attachment' || (imported.asset.kind !== 'audio' && (imported.asset.width !== item.width || imported.asset.height !== item.height))) throw new TypeError('Selected AEP media dimensions or type differ from the source.');
				bindings.push({ sourceId: item.id, asset: imported.asset }); bodies.push(imported);
			}
			const project = convertNativeAep(document, { projectId: allocateId(), title: selection.name, allocateId, source, media: bindings, fonts, primaryCompositionId: selection.primaryCompositionId });
			signal?.throwIfAborted(); const prepared = Object.freeze({ project, media: freezeMotionValue(document.footage.filter(item => item.color === null)), fonts: Object.freeze([...fontNames]) });
			const retainedAssets = new Map(project.assets.map(asset => [asset.id, asset]));
			preparations.set(prepared, { bodies: bodies.map(({ asset, body }) => ({ asset: retainedAssets.get(asset.id)!, body })), state: 'ready' }); return prepared;
		},
		needsCleanup(prepared: PreparedNativeAepImport): boolean { return preparations.get(prepared)?.state === 'cleanup-failed'; },
		async retryCleanup(prepared: PreparedNativeAepImport): Promise<void> {
			const retained = preparations.get(prepared); if (retained?.state !== 'cleanup-failed' || !retained.cleanup) throw new Error('No pending AEP cleanup.');
			await retained.cleanup(); delete retained.cleanup; retained.state = 'ready';
		},
		async commit(prepared: PreparedNativeAepImport, acknowledge: boolean, signal?: AbortSignal): Promise<MotionscaperProject> {
			signal?.throwIfAborted(); const retained = preparations.get(prepared);
			if (!retained || retained.state !== 'ready') throw new Error('AEP review is unknown, closed or already published.');
			if (acknowledge !== true) throw new Error('Review and acknowledge the native AEP conversion report before importing.');
			retained.state = 'publishing'; let transaction: NativeAepImportTransaction | undefined;
			try {
				transaction = await ports.begin(prepared.project);
				for (const { asset, body } of retained.bodies) {
					const digest = createDigest(); let written = 0;
					for (let offset = 0; offset < body.size; offset += 4 * 1024 * 1024) {
						signal?.throwIfAborted(); const bytes = new Uint8Array(await body.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer()); signal?.throwIfAborted();
						digest.update(bytes); written += bytes.length; await transaction.writeAssetChunk(asset, bytes);
					}
					if (written !== asset.byteLength || hex(digest.digest()) !== asset.sha256) throw new Error('Retained AEP source or media changed before publication.');
					signal?.throwIfAborted(); await transaction.finishAsset(asset);
				}
				signal?.throwIfAborted(); await transaction.commit(prepared.project); retained.state = 'committed'; return prepared.project;
			} catch (error) {
				if (transaction) try { await transaction.rollback(); } catch (cleanup) {
					retained.state = 'cleanup-failed'; retained.cleanup = () => transaction!.rollback(); throw aggregateScapeErrors(error, [cleanup], 'Native AEP import failed and private asset cleanup also failed.');
				}
				retained.state = 'ready'; throw error;
			}
		},
	});
}
