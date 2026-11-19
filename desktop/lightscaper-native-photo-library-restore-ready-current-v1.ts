/* SPDX-License-Identifier: AGPL-3.0-only */

import { inspectLightscaperNativePhotoLibraryRestoreCandidateCurrentV1 as inspect } from './lightscaper-native-photo-library-restore-claim-current-v1.ts';
import { readLightscaperNativeCatalogRestoreReceiptCurrentV1 as readCatalog } from './lightscaper-native-catalog-restore-stage-current-v1.ts';
import { readLightscaperNativePhotoMediaRestoreReceiptCurrentV1 as readMedia } from './lightscaper-native-photo-media-restore-stage-current-v1.ts';
import { normalizeLightscaperNativePhotoLibraryRestoreReceiptCurrentV1 as normalize,
	type LightscaperNativePhotoLibraryRestoreReceiptCurrentV1 as Receipt } from './lightscaper-native-photo-library-restore-records-current-v1.ts';

export type LightscaperNativePhotoLibraryRestoreReadyCurrentV1 = Readonly<object>;
export interface LightscaperNativePhotoLibraryRestoreReadyBindingCurrentV1 {
	readonly allocation: ReturnType<typeof inspect>['allocation'];
	readonly registryOwner: string;
	readonly manifestSha256: string;
	readonly receipt: Readonly<Receipt>;
	assertCurrent(): void;
}
type State = { readonly candidate: ReturnType<typeof inspect>; readonly binding: Readonly<LightscaperNativePhotoLibraryRestoreReadyBindingCurrentV1>; consumed: boolean };
const issued = new WeakSet<object>(), proofs = new WeakMap<object, State>();

/** Called at the shared archive codec's post-reader publication barrier. Only
 * genuine sealed stages whose actual candidate has joined close can mint one
 * proof. Receipt DTOs alone never authorize native selection publication. */
export function createLightscaperNativePhotoLibraryRestoreReadyCurrentV1(candidate: unknown, catalogReceipt: unknown,
	mediaReceipt: unknown): LightscaperNativePhotoLibraryRestoreReadyCurrentV1 {
	const identity = inspect(candidate); identity.assertCurrent(); identity.assertRetired();
	const catalog = readCatalog(catalogReceipt, identity.allocation), media = readMedia(mediaReceipt, identity.allocation);
	if (catalog.catalogId !== media.catalogId || catalog.photoCount !== media.photoCount || media.catalogInventorySha256 !== catalog.inventorySha256) {
		throw new Error('Native restore stages do not attest the same complete catalog inventory.');
	}
	const receipt = normalize({ schemaVersion: 1, kind: 'native-photo-library-restore-ready', catalogId: catalog.catalogId,
		catalogRevision: catalog.catalogRevision, photoCount: catalog.photoCount, stackCount: catalog.stackCount,
		savedCollectionCount: catalog.savedCollectionCount, indexRevision: catalog.indexRevision,
		originalCount: media.originalCount, originalByteLength: media.originalByteLength,
		catalogInventorySha256: catalog.inventorySha256, mediaInventorySha256: media.inventorySha256 }, identity.allocation);
	const object = candidate as object;
	if (issued.has(object)) throw new Error('Native restore candidate already issued its Ready proof.');
	const proof = Object.freeze({}), binding = Object.freeze({ allocation: identity.allocation, registryOwner: identity.registryOwner,
		manifestSha256: identity.manifestSha256, receipt, assertCurrent: (): void => { identity.assertCurrent(); identity.assertRetired(); } });
	issued.add(object); proofs.set(proof, { candidate: identity, binding, consumed: false }); return proof;
}

export function consumeLightscaperNativePhotoLibraryRestoreReadyCurrentV1(value: unknown,
	owner: object): Readonly<LightscaperNativePhotoLibraryRestoreReadyBindingCurrentV1> {
	const state = value !== null && typeof value === 'object' ? proofs.get(value) : undefined;
	if (!state || state.consumed || state.candidate.owner !== owner) throw new TypeError('Native restore publication requires its actual owner-bound unused Ready proof.');
	state.binding.assertCurrent(); state.consumed = true; return state.binding;
}
