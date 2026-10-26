/* SPDX-License-Identifier: AGPL-3.0-only */

const borrowers = new WeakMap<object, number>();

/** Input graphs may outlive a stopped transport or a project switch. */
export function retainRealtimeContext(context: object): () => void {
	borrowers.set(context, (borrowers.get(context) ?? 0) + 1);
	let retained = true;
	return () => {
		if (!retained) return;
		retained = false;
		const remaining = (borrowers.get(context) ?? 1) - 1;
		if (remaining > 0) borrowers.set(context, remaining);
		else borrowers.delete(context);
	};
}

export function hasRealtimeContextBorrowers(context: object): boolean {
	return borrowers.has(context);
}
