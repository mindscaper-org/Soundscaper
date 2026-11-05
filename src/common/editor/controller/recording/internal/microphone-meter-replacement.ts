/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MicrophoneMeterInputReplacement {
	finish(outcome: 'ready' | 'failed' | 'superseded' | 'disposed'): Promise<void>;
}

/** Expected native reconnections retain user intent while retiring only its old graph. */
export function createMicrophoneMeterReplacement(ports: Readonly<{
	suspend(): void;
	resume(): Promise<unknown>;
	fail(): Promise<unknown>;
	cancel(): void;
}>) {
	let current: object | null = null, attached: object | null = null;
	let pending: Readonly<{ promise: Promise<void>; release(): void }> | null = null;
	const release = (): void => { const previous = pending; pending = null; previous?.release(); };
	return Object.freeze({
		get pending(): boolean { return pending !== null; },
		settled: (): Promise<void> => pending?.promise ?? Promise.resolve(),
		begin(): MicrophoneMeterInputReplacement {
			const owner = {}; current = owner; attached = null;
			if (!pending) {
				let resolve: () => void = () => {};
				const promise = new Promise<void>(completed => { resolve = completed; });
				pending = { promise, release: resolve };
			}
			try { ports.suspend(); }
			catch (error) { if (current === owner) { current = null; release(); } throw error; }
			return Object.freeze({ async finish(outcome: Parameters<MicrophoneMeterInputReplacement['finish']>[0]): Promise<void> {
				if (outcome === 'disposed' && attached === owner) { attached = null; ports.cancel(); return; }
				if (current !== owner || outcome === 'superseded') return;
				if (outcome === 'disposed') {
					current = null;
					try { ports.cancel(); } finally { release(); }
				} else if (outcome === 'failed') {
					try { await ports.fail(); }
					finally { if (current === owner) { current = null; release(); } }
				} else { current = null; attached = owner; release(); await ports.resume(); }
			} });
		},
		dispose(): void { current = null; attached = null; release(); },
	});
}
