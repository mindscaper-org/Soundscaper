/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LightscaperNativePhotoLibraryComponentsCurrentV1 as Components } from './lightscaper-native-photo-library-components-current-v1.ts';
import type { LightscaperNativePhotoSettingsCurrentV1 as Settings } from './lightscaper-native-photo-settings-current-v1.ts';

export interface LightscaperNativePhotoSessionBindingCurrentV1 {
	readonly catalogId: string;
	readonly selectionToken: string;
	readonly signal: AbortSignal;
	readonly components: Readonly<Components>;
	readonly anchor: Settings;
	assertCurrent(): void;
	stop(): void;
	release(): void;
	quarantine(): void;
}
type Binding = Readonly<LightscaperNativePhotoSessionBindingCurrentV1>;
type Claim = { readonly binding: Binding; lease: boolean; exclusive: boolean };
const claims = new WeakMap<object, Claim>();

/** Fixed Scopes constructor path calls this only after booking its selected
 * epoch and opening the actual same-generation native components. This module
 * is Main-private; no path, claim or registration function crosses IPC. */
export function createLightscaperNativePhotoSessionClaimCurrentV1(binding: Binding): Readonly<object> {
	binding.assertCurrent();
	const claim = Object.freeze({}); claims.set(claim, { binding: Object.freeze(binding), lease: false, exclusive: false }); return claim;
}
function read(value: unknown): Claim {
	const claim = value !== null && typeof value === 'object' ? claims.get(value) : undefined;
	if (!claim) throw new TypeError('Native Session requires its genuine selected Scopes claim.');
	claim.binding.assertCurrent(); return claim;
}
export function consumeLightscaperNativePhotoSessionClaimCurrentV1(value: unknown): Binding {
	const claim = read(value);
	if (claim.lease) throw new TypeError('Native Session lease claim was already consumed.');
	claim.lease = true; return claim.binding;
}
export function consumeLightscaperNativePhotoSessionExclusiveClaimCurrentV1(value: unknown): Readonly<Pick<Binding,
	'catalogId' | 'selectionToken' | 'signal' | 'assertCurrent' | 'quarantine'>> {
	const claim = read(value);
	if (claim.exclusive) throw new TypeError('Native Session exclusive claim was already consumed.');
	claim.exclusive = true;
	const { catalogId, selectionToken, signal, assertCurrent, quarantine } = claim.binding;
	return Object.freeze({ catalogId, selectionToken, signal, assertCurrent, quarantine });
}
