/* SPDX-License-Identifier: AGPL-3.0-only */

const OWNERS = new WeakSet<object>();

/** Only the controller's explicit effects owner guarantees replacement on library writes. */
export function registerEffectsLibraryOwner<State extends object>(state: State): State {
	OWNERS.add(state); return state;
}
export function registerEffectsLibraryAccess<Access extends object>(access: Access, owner: object): Access {
	if (OWNERS.has(owner)) OWNERS.add(access);
	return access;
}
export function ownsEffectLibraries(state: object): boolean { return OWNERS.has(state); }
