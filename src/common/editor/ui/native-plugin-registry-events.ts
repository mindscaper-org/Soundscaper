/* SPDX-License-Identifier: AGPL-3.0-only */
const listeners = new Set<() => void>();

/** Existing desktop surfaces share registry changes without changing document state. */
export function subscribeNativePluginRegistryChanges(listener: () => void): () => void {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}

export function notifyNativePluginRegistryChanged(): void {
	for (const listener of listeners) listener();
}
