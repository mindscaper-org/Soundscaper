/* SPDX-License-Identifier: AGPL-3.0-only */

/** Serializes guest opening and retirement without letting a retired opening regain ownership. */
export function createFramescaperWebVcrGuestLifecycle() {
	let generation = 0;
	let pending: Promise<void> | null = null;
	let pendingKind: 'activate' | 'close' | null = null;
	function retain(operation: Promise<void>, kind: 'activate' | 'close'): Promise<void> {
		pending = operation;
		pendingKind = kind;
		void operation.finally(() => {
			if (pending === operation) { pending = null; pendingKind = null; }
		}).catch(() => undefined);
		return operation;
	}
	return Object.freeze({
		activate(action: (isCurrent: () => boolean) => Promise<void>): Promise<void> {
			if (pendingKind === 'activate' && pending) return pending;
			const reservation = ++generation;
			const run = () => action(() => generation === reservation);
			return retain(pending ? pending.catch(() => undefined).then(run) : run(), 'activate');
		},
		close(action: (opening: Promise<void> | null) => Promise<void>): Promise<void> {
			if (pendingKind === 'close' && pending) return pending;
			generation += 1;
			return retain(action(pending), 'close');
		},
	});
}
