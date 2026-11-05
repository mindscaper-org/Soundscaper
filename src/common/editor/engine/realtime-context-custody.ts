/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EngineAudioContext } from './public-api.ts';

const borrowers = new WeakMap<object, number>();
export interface EngineRealtimeContextLease {
	/** The owner alone creates, replaces and closes this context. */
	current(): EngineAudioContext | null;
}
const leases = new WeakMap<object, EngineRealtimeContextLease>();
const held = new WeakMap<object, Readonly<{ context: EngineAudioContext; release(): void }>>();
const borrowed = new WeakMap<object, WeakSet<EngineAudioContext>>();

export function configureRealtimeContextLease(engine: object, lease?: EngineRealtimeContextLease): void {
	if (lease) leases.set(engine, lease);
}

export function acquireLeasedRealtimeContext(engine: object): EngineAudioContext | null {
	const context = leases.get(engine)?.current() ?? null;
	if (!context) return null;
	if (context.state === 'closed') throw new DOMException('The borrowed audio context closed.', 'AbortError');
	if (held.get(engine)?.context !== context) {
		held.get(engine)?.release();
		held.set(engine, { context, release: retainRealtimeContext(context) });
		const known = borrowed.get(engine) ?? new WeakSet<EngineAudioContext>();
		known.add(context); borrowed.set(engine, known);
	}
	return context;
}

export function isBorrowedRealtimeContext(engine: object, context: object): boolean {
	return held.get(engine)?.context === context;
}

export function realtimeContextLeaseChanged(engine: object): boolean {
	const lease = leases.get(engine);
	return lease !== undefined && (lease.current() ?? null) !== (held.get(engine)?.context ?? null);
}

export function assertLeasedRealtimeSampleRate(engine: object, sampleRate: number): void {
	const context = leases.get(engine)?.current();
	if (context && context.sampleRate !== sampleRate) throw new RangeError('A preview cannot retime its borrowed audio context.');
}

/** A late admission may release the same lease twice; it must never close its owner's clock. */
export async function releaseEngineRealtimeContext(engine: object, context: EngineAudioContext | null): Promise<void> {
	if (!context) return;
	if (borrowed.get(engine)?.has(context)) {
		const current = held.get(engine);
		if (current?.context === context) { held.delete(engine); current.release(); }
		return;
	}
	if (context.state !== 'closed') await context.close?.();
}

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
