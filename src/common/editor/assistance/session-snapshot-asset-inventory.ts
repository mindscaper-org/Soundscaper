/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readSessionSnapshots, sessionSnapshotProjects, sessionSnapshotSourceIdMap } from '../session-snapshots.ts';
import { normalizeAssistanceAssetReferencesV1, validateAssistanceAssetSourceBindingsV1, type AssistanceAssetReferenceV1 } from './assistance-asset-reference-v1.ts';

/** Scope equal asset IDs in independent editing states without altering persisted identities. */
export function sessionSnapshotAssistanceInventory(project: Record<string, unknown>): readonly Readonly<AssistanceAssetReferenceV1>[] {
	const snapshots = readSessionSnapshots(project);
	return [project, ...sessionSnapshotProjects(project)].flatMap((view, index) => {
		const assets = normalizeAssistanceAssetReferencesV1(view.assistanceAssets);
		validateAssistanceAssetSourceBindingsV1(assets, view.sources);
		return assets.map(asset => ({ ...asset, id: scopedAssetId(index === 0 ? null : snapshots[index - 1]!.id, asset.id) }));
	});
}

export function replaceSessionSnapshotAssistanceInventory(
	project: Record<string, unknown>, assets: readonly Readonly<AssistanceAssetReferenceV1>[],
): void {
	const byId = new Map(assets.map(asset => [asset.id, asset]));
	function replace(view: Record<string, unknown>, snapshotId: string | null): void {
		view.assistanceAssets = normalizeAssistanceAssetReferencesV1(view.assistanceAssets).map(original => {
			const updated = byId.get(scopedAssetId(snapshotId, original.id));
			if (!updated) throw new ReferenceError('A snapshot assistance asset is missing.');
			return { ...updated, id: original.id };
		});
	}
	replace(project, null);
	for (const snapshot of readSessionSnapshots(project)) replace(snapshot.state as Record<string, unknown>, snapshot.id);
}

function scopedAssetId(snapshotId: string | null, assetId: string): string {
	return `snapshot-asset:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([snapshotId, assetId]))))}`;
}

export function sessionSnapshotAssistanceSourceMaps(project: Record<string, unknown>, mapping: ReadonlyMap<string, string>) {
	const result = new Map<string, ReadonlyMap<string, string>>();
	for (const asset of normalizeAssistanceAssetReferencesV1(project.assistanceAssets)) result.set(scopedAssetId(null, asset.id), mapping);
	for (const snapshot of readSessionSnapshots(project)) {
		const snapshotMapping = sessionSnapshotSourceIdMap(snapshot, mapping);
		for (const asset of normalizeAssistanceAssetReferencesV1(snapshot.state.assistanceAssets)) {
			result.set(scopedAssetId(snapshot.id, asset.id), snapshotMapping);
		}
	}
	return result;
}
