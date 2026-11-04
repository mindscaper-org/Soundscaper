/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CapturePhase } from '../../../framescaper-capture-domain.ts';

interface FailureDependencies {
	blocked(): boolean;
	phase(): CapturePhase;
	hasDurableSession(): boolean;
	abortPreparation(error: unknown): void;
	stopPreparation(): void;
	waitForStart(): PromiseLike<unknown> | null;
	failBeforeDurability(error: unknown): Promise<void>;
	recover(error: unknown): Promise<void>;
	track(operation: Promise<void>): Promise<void>;
}

/** A failed setup has no recoverable media; join it before releasing its origin. */
export function createFramescaperCaptureFailureAdmission(dependencies: FailureDependencies) {
	let failedPreparation: Promise<void> | null = null;
	return (error: unknown): void => {
		if (dependencies.blocked() || failedPreparation) return;
		if (!['countdown', 'recording', 'paused', 'finalizing'].includes(dependencies.phase())) return;
		if (dependencies.hasDurableSession()) {
			void dependencies.recover(error).catch(() => undefined);
			return;
		}
		dependencies.abortPreparation(error);
		dependencies.stopPreparation();
		failedPreparation = dependencies.track(Promise.resolve().then(dependencies.waitForStart)
			.catch(() => undefined).then(() => dependencies.failBeforeDurability(error))
			.finally(() => { failedPreparation = null; }));
		void failedPreparation.catch(() => undefined);
	};
}
