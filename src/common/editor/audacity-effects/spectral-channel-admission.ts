/* SPDX-License-Identifier: GPL-3.0-only */

/** Shared finite PCM admission for offline and owned live spectral processing. */
export function validateAudacitySpectralChannels(channels: readonly Float32Array[], sampleRate: number): { frameCount: number } {
	if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be a positive finite number.');
	if (!Array.isArray(channels) || channels.length === 0) throw new TypeError('channels must be a non-empty array of Float32Array objects.');
	let frameCount: number | null = null;
	for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
		const channel = channels[channelIndex];
		if (!(channel instanceof Float32Array)) throw new TypeError(`channels[${String(channelIndex)}] must be a Float32Array.`);
		if (frameCount === null) frameCount = channel.length;
		else if (channel.length !== frameCount) throw new RangeError('All channels must have the same frame count.');
		for (let frame = 0; frame < channel.length; frame += 1) {
			if (!Number.isFinite(channel[frame])) throw new RangeError(`channels[${String(channelIndex)}][${String(frame)}] must be finite.`);
		}
	}
	if (!frameCount) throw new RangeError('The audio selection must contain at least one frame.');
	return { frameCount };
}
