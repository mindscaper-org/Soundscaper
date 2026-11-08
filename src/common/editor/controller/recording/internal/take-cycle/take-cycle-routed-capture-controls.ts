/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TakeCycleRoutedLiveSource } from './take-cycle-routed-capture-state.ts';
import type { TakeCycleRoutedCaptureService } from './take-cycle-routed-capture-types.ts';
import { finiteTakeCycleRoutedGain } from './take-cycle-routed-capture-validation.ts';

type ControlledSource = Pick<TakeCycleRoutedLiveSource, 'kind' | 'controller'>;

/** A retired preparation can release only its own live input binding. */
export function createTakeCyclePendingInputBinding() {
	let current: Readonly<{ sources: readonly ControlledSource[]; assertCurrent(): void }> | null = null;
	return Object.freeze({
		bind(sources: readonly ControlledSource[], assertCurrent: () => void) {
			const owned = { sources, assertCurrent };
			current = owned;
			return () => { if (current === owned) current = null; };
		},
		read(): readonly ControlledSource[] | null {
			const owned = current;
			if (!owned) return null;
			try { owned.assertCurrent(); } catch { return null; }
			return current === owned ? owned.sources : null;
		},
	});
}

export function synchronizeTakeCycleInputGain(sources: readonly ControlledSource[], value: number): void {
	const gain = finiteTakeCycleRoutedGain(value);
	for (const source of sources) if (source.kind === 'device') source.controller?.setInputGain(gain);
}

/** Live input controls belong only to the currently owned microphone capture. */
export function createTakeCycleRoutedCaptureControls(
	activeSources: () => readonly ControlledSource[] | null,
	start: TakeCycleRoutedCaptureService['start'],
	stop: TakeCycleRoutedCaptureService['stop'],
	preparingSources: () => readonly ControlledSource[] | null = () => null,
): Readonly<TakeCycleRoutedCaptureService> {
	return Object.freeze({
		get active() { return activeSources() !== null; },
		start,
		stop,
		pause() { throw new Error('Take cycle routed capture cannot be paused.'); },
		setInputGain(value: number) {
			synchronizeTakeCycleInputGain(activeSources() ?? preparingSources() ?? [], value);
		},
		setMonitoring(enabled: boolean) {
			for (const source of activeSources() ?? []) if (source.kind === 'device') source.controller?.setMonitoring(enabled);
		},
	});
}
