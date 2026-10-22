/* SPDX-License-Identifier: AGPL-3.0-only */

interface ImportBusyState { importing: boolean }

export interface ImportBusyClaim {
	isCurrent(): boolean;
	finish(): boolean;
}

const OWNERS = new WeakMap<ImportBusyState, object>();

/** One shared flag serves several import services; only its latest owner may clear it. */
export function claimImportBusyState(state: ImportBusyState): ImportBusyClaim {
	const token = {};
	OWNERS.set(state, token);
	state.importing = true;
	return Object.freeze({
		isCurrent: () => OWNERS.get(state) === token,
		finish() {
			if (OWNERS.get(state) !== token) return false;
			OWNERS.delete(state);
			state.importing = false;
			return true;
		},
	});
}
