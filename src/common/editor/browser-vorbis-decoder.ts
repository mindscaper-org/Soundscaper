/* SPDX-License-Identifier: AGPL-3.0-only */

/** Qualify the maintained native backend; other browsers retain packet decoding. */
export function admitsNativeSurroundVorbisBackend(userAgent: unknown = globalThis.navigator?.userAgent): boolean {
	return typeof userAgent === 'string' && /^Mozilla\/5\.0\s/u.test(userAgent)
		&& /\bAppleWebKit\/\d+(?:\.\d+)*\b/u.test(userAgent) && /\bSafari\/\d+/u.test(userAgent)
		&& !/\b(?:Chrome|HeadlessChrome|Chromium|Edg|OPR|Firefox|CriOS|FxiOS|iPhone|iPad|iPod)\b/iu.test(userAgent);
}

/** A successful support advertisement cannot make this backend's stalled packets usable. */
export function assertVorbisPacketDecoder(channelCount: number): void {
	if (Number.isSafeInteger(channelCount) && channelCount >= 3 && channelCount <= 8 && admitsNativeSurroundVorbisBackend()) {
		throw new RangeError('This browser cannot import this surround Vorbis source. Convert it to WAV or FLAC, or use another supported browser.');
	}
}
