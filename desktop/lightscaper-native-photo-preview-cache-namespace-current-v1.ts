/* SPDX-License-Identifier: AGPL-3.0-only */
/** Canonical module ownership is shared even when a test imports the facade by
 * a query URL. Actual Scopes supplies cross-process writer exclusion; this
 * registry only coordinates same-process cache owners, not a filesystem lock. */
interface Namespace { owners: number; pending: number; failed: boolean; tail: Promise<void> }
const quarantined = new Set<object>();
const namespaces = new Map<string, Namespace>();
export function registerLightscaperNativePreviewNamespaceCurrentV1(path: string): Readonly<{
	assertCurrent(): void;
	quarantine(owner: object): void;
	reserve(): Readonly<{ wait: Promise<void>; release(): void }>;
	retire(): void;
}> {
	let namespace = namespaces.get(path);
	if (!namespace) { namespace = { owners: 0, pending: 0, failed: false, tail: Promise.resolve() }; namespaces.set(path, namespace); }
	const actual = namespace; actual.owners++; let retired = false;
	const prune = (): void => { if (actual.owners === 0 && actual.pending === 0 && !actual.failed && namespaces.get(path) === actual) namespaces.delete(path); };
	return Object.freeze({
		assertCurrent(): void { if (retired || actual.failed) throw new Error('Native preview namespace is retired or quarantined.'); },
		quarantine(owner: object): void { actual.failed = true; quarantined.add(owner); },
		reserve() {
			if (retired || actual.failed) throw new Error('Native preview namespace owner is retired or quarantined.');
			if (actual.pending >= 4) throw new RangeError('Native preview accepted-operation capacity is full.');
			actual.pending++; const wait = actual.tail; let resolve!: () => void, done = false;
			const completed = new Promise<void>(accept => { resolve = accept; }); actual.tail = wait.then(() => completed);
			return Object.freeze({ wait, release(): void { if (!done) { done = true; actual.pending--; resolve(); prune(); } } });
		},
		retire(): void { if (!retired) { retired = true; actual.owners--; prune(); } },
	});
}
