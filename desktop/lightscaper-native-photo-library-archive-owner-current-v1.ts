/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from './lightscaper-native-photo-library-scopes-current-v1.ts';

type Owner = Readonly<Pick<Scopes, 'openSelected' | 'beginRestore' | 'publishRestoreReady'>>;
const owners = new WeakMap<object, Owner>();

/** Called once by the private Scopes constructor, before its owner escapes.
 * The lazy archive implementation need not import its owning class at runtime. */
export function registerLightscaperNativePhotoLibraryArchiveOwnerCurrentV1(owner: object, methods: Owner): void {
	if (owners.has(owner)) throw new Error('Native archive owner is already registered.');
	owners.set(owner, Object.freeze(methods));
}
export function readLightscaperNativePhotoLibraryArchiveOwnerCurrentV1(value: unknown): Owner {
	const owner = value !== null && typeof value === 'object' ? owners.get(value) : undefined;
	if (!owner) throw new TypeError('Native archive restore requires its actual registered Scopes owner.');
	return owner;
}
