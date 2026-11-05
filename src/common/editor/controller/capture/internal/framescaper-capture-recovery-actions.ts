/* SPDX-License-Identifier: AGPL-3.0-only */
import type { FramescaperCaptureDurableSession } from '../framescaper-capture-session-types.ts';

type RecoveryDecision = 'recovered' | 'import-as-is' | 'discarded';

interface RecoveryDependencies {
	assertActive(): void;
	session(): FramescaperCaptureDurableSession | null;
	settled(): Promise<unknown> | null;
	begin(): void;
	finalize(session: FramescaperCaptureDurableSession, provenance: 'recovered' | 'import-as-is'): Promise<unknown> | unknown;
	discard(session: FramescaperCaptureDurableSession): Promise<unknown>;
	complete(decision: RecoveryDecision): void;
	fail(error: unknown): void;
	notify(): void;
	track(operation: Promise<void>): Promise<void>;
}

/** A durable recovery session accepts one publication or deletion decision at a time. */
export function createFramescaperCaptureRecoveryActions(dependencies: RecoveryDependencies) {
	let pending: Readonly<{ decision: RecoveryDecision; operation: Promise<void> }> | null = null;
	function decide(decision: RecoveryDecision): Promise<void> {
		dependencies.assertActive();
		if (pending) return pending.decision === decision ? pending.operation
			: Promise.reject(new Error('A different capture recovery decision is already in progress.'));
		if (!dependencies.session()) throw new Error('No recoverable Framescaper capture is selected.');
		dependencies.begin();
		const operation = dependencies.track(Promise.resolve().then(async () => {
			try {
				await dependencies.settled();
				const session = dependencies.session();
				if (!session) throw new Error('No recoverable Framescaper capture is selected.');
				if (decision === 'discarded') await dependencies.discard(session);
				else await dependencies.finalize(session, decision);
				dependencies.complete(decision);
			} catch (error) { dependencies.fail(error); throw error; }
			finally { pending = null; }
		}));
		pending = { decision, operation };
		dependencies.notify();
		return operation;
	}
	return Object.freeze({ recover: (provenance: 'recovered' | 'import-as-is') => decide(provenance),
		discard: () => decide('discarded') });
}
