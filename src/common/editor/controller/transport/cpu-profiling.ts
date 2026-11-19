/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CpuProfilerBridge, CpuProfileReading } from '../../cpu-profile-contract.ts';
import { retainCpuProfileInstrumentation } from '../../engine/cpu-profile-instrumentation.ts';

/** One opt-in session; no overlapping captures, timers or publications after close. */
export function startCpuProfiling<Timer>(options: {
	readonly bridge: CpuProfilerBridge;
	readonly publish: (value: CpuProfileReading) => void;
	readonly onError: (error: unknown) => void;
	readonly schedule: (callback: () => void, delayMs: number) => Timer;
	readonly clear: (timer: Timer) => void;
}): () => void {
	const release = retainCpuProfileInstrumentation();
	let disposed = false;
	let timer: Timer | undefined;
	const capture = async (): Promise<void> => {
		try {
			const reading = await options.bridge.capture();
			if (disposed) return;
			options.publish(reading);
			timer = options.schedule(() => { void capture(); }, 250);
		} catch (error) { if (!disposed) options.onError(error); }
	};
	void capture();
	return () => {
		if (disposed) return;
		disposed = true;
		release();
		if (timer !== undefined) options.clear(timer);
		void options.bridge.cancel().catch(() => {});
	};
}
