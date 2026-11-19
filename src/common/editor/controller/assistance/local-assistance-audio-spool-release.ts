/* SPDX-License-Identifier: AGPL-3.0-only */

/** Small eager-safe registry for transferring and releasing disk-backed prepared audio. */

const RELEASES = new WeakMap<Blob, () => Promise<void>>();

export function bindLocalAssistancePreparedAudioWaveRelease(
	body: Blob,
	releaseValue: () => Promise<void>,
): void {
	RELEASES.set(body, releaseValue);
}

export function takeLocalAssistancePreparedAudioWaveRelease(
	body: Blob,
): (() => Promise<void>) | undefined {
	const release = RELEASES.get(body);
	RELEASES.delete(body);
	return release;
}

export async function releaseLocalAssistancePreparedAudioWave(body: Blob): Promise<void> {
	if (!(body instanceof Blob)) return;
	await takeLocalAssistancePreparedAudioWaveRelease(body)?.();
}
