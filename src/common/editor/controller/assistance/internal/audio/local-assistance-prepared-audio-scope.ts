/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	bindLocalAssistancePreparedAudioWaveRelease,
	takeLocalAssistancePreparedAudioWaveRelease,
} from '../../local-assistance-audio-spool-release.ts';

/** Own prepared audio until staging and review preparation have both finished. */
export function createLocalAssistancePreparedAudioScope() {
	const disposals = new Map<Blob, () => Promise<void>>();
	return {
		capture<T>(prepared: T): T {
			const inputs = (prepared as Readonly<{ inputs?: unknown }> | null)?.inputs;
			if (!Array.isArray(inputs)) return prepared;
			for (const input of inputs as readonly (Readonly<{ bytes?: unknown }> | null)[]) {
				const body = input?.bytes;
				if (!(body instanceof Blob)) continue;
				const release = takeLocalAssistancePreparedAudioWaveRelease(body);
				if (release) disposals.set(body, release);
			}
			return prepared;
		},
		async release(retained: Blob | null): Promise<void> {
			const release = retained && disposals.get(retained);
			if (retained && release) {
				disposals.delete(retained);
				bindLocalAssistancePreparedAudioWaveRelease(retained, release);
			}
			await Promise.allSettled(Array.from(disposals.values(), async dispose => dispose()));
		},
	};
}
