/* SPDX-License-Identifier: AGPL-3.0-only */

interface ConfigurableAudioTrack {
	getDecoderConfig(): Promise<AudioDecoderConfig | null>;
}

/** Some native Opus decoders advertise support but retain the header's lookahead. */
export async function preferContainerOpusPreSkipDecoder(track: ConfigurableAudioTrack, signal?: AbortSignal,
	options: Readonly<{ opusTimestampsIncludePreSkip?: boolean }> = {}): Promise<void> {
	const config = await track.getDecoderConfig();
	signal?.throwIfAborted();
	if (!config || !hasReviewedContainerOpusPreSkip(config)) return;
	const { preferReviewedAudioImportDecoder } = await import('./browser-reviewed-streamed-audio-decoders.ts');
	signal?.throwIfAborted();
	if (preferReviewedAudioImportDecoder('opus', config, options)) track.getDecoderConfig = () => Promise.resolve(config);
}

/** The existing reviewed ABI owns mapping-family0 mono/stereo only; retain other native profiles. */
export function hasReviewedContainerOpusPreSkip(config: AudioDecoderConfig): boolean {
	if (config.codec !== 'opus' || config.sampleRate !== 48_000 || ![1, 2].includes(config.numberOfChannels)) return false;
	const description = config.description;
	if (!description || description.byteLength !== 19) return false;
	const bytes = ArrayBuffer.isView(description)
		? new Uint8Array(description.buffer, description.byteOffset, description.byteLength) : new Uint8Array(description);
	return bytes[8] === 1 && bytes[9] === config.numberOfChannels && bytes[18] === 0
		&& [79, 112, 117, 115, 72, 101, 97, 100].every((byte, index) => bytes[index] === byte)
		&& new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(10, true) > 0;
}
