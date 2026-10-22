/* SPDX-License-Identifier: AGPL-3.0-only */

interface ByteSource {
	readonly size: number;
	slice(start: number, end: number): Readonly<{ arrayBuffer(): PromiseLike<ArrayBuffer> }>;
}

/** Estimate encoded audio alone; pictures, lyrics and container padding are not a bitrate. */
export async function readDesktopOriginalAudioBitRate(file: ByteSource): Promise<number | null> {
	const { ALL_FORMATS, CustomSource, Input } = await import('mediabunny');
	const input = new Input({ source: new CustomSource({ getSize: () => file.size, maxCacheSize: 1024 ** 2,
		read: async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()),
	}), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) return null;
		const stats = await track.computePacketStats(1024);
		const kilobits = Math.round(stats.averageBitrate / 1000);
		return Number.isSafeInteger(kilobits) && kilobits > 0 ? kilobits : null;
	} catch {
		// Codec/container proof lives with the caller; an unavailable estimate is optional.
		return null;
	} finally { input.dispose(); }
}
