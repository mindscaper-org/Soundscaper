/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Find the nearest linked-channel zero crossing. Every channel must reach zero
 * or change sign at the same frame; otherwise the edit can still click in a
 * channel that is far from zero. If a window has no shared crossing, its
 * quietest frame is returned.
 */
export function findNearestAudioZeroCrossing(channels, targetFrame, options = {}) {
	validateChannels(channels);
	if (!channels[0].length) return 0;
	const target = Math.max(0, Math.min(channels[0].length - 1, Math.round(Number(targetFrame) || 0)));
	const maximumDistance = Math.max(0, Math.min(
		channels[0].length - 1,
		Number.isSafeInteger(Number(options.maximumDistance))
			? Number(options.maximumDistance)
			: channels[0].length - 1,
	));
	let quietestFrame = target;
	let quietestScore = Infinity;
	for (let distance = 0; distance <= maximumDistance; distance += 1) {
		let crossing = null;
		let crossingScore = Infinity;
		for (let side = 0; side < (distance === 0 ? 1 : 2); side += 1) {
			const frame = side === 0 ? target - distance : target + distance;
			if (frame < 0 || frame >= channels[0].length) continue;
			let score = 0;
			let linkedCrossing = true;
			for (const channel of channels) {
				const current = Number(channel[frame]) || 0;
				score += Math.abs(current);
				if (!linkedCrossing || current === 0) continue;
				const previous = frame > 0 ? Number(channel[frame - 1]) || 0 : current;
				if (previous !== 0 && !((previous < 0 && current > 0) || (previous > 0 && current < 0))) linkedCrossing = false;
			}
			if (score < quietestScore) {
				quietestFrame = frame;
				quietestScore = score;
			}
			if (linkedCrossing && score < crossingScore) {
				crossing = frame;
				crossingScore = score;
			}
		}
		if (crossing != null) return crossing;
	}
	return quietestFrame;
}

function validateChannels(channels) {
	if (!Array.isArray(channels) || !channels.length
		|| channels.some((channel) => !(channel instanceof Float32Array))) {
		throw new TypeError('Planar Float32 audio channels are required.');
	}
	if (channels.some((channel) => channel.length !== channels[0].length)) {
		throw new RangeError('Audio channels must have equal lengths.');
	}
}
