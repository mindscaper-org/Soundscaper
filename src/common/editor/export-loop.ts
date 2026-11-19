/* SPDX-License-Identifier: AGPL-3.0-only */

/** Resolved ranges are retained by queued deliveries after the loop was selected. */
export function exportRendersAsLoop(options: Readonly<Record<string, unknown>>): boolean {
	if (options.renderAsLoop !== true) return false;
	if ((options.mode != null && options.mode !== 'mix') || options.masteringSequenceId
		|| (options.range !== 'loop' && (!options.range || typeof options.range !== 'object'))) {
		throw new RangeError('Render as loop requires a mixed In/Out loop delivery.');
	}
	return true;
}

/** Fold the processed remainder modulo the loop length, before quantization or resampling. */
export function wrapLoopRender(channels: readonly Float32Array[], loopFrames: number, sampleRate: number) {
	if (!Number.isSafeInteger(loopFrames) || loopFrames < 1 || !channels.length
		|| channels.some(channel => channel.length < loopFrames || channel.length !== channels[0]!.length)) {
		throw new RangeError('Loop rendering requires complete, equal channels covering the loop.');
	}
	const wrapped = channels.map(channel => {
		for (let frame = loopFrames; frame < channel.length; frame += 1) {
			channel[frame % loopFrames]! += channel[frame]!;
		}
		return channel.subarray(0, loopFrames);
	});
	return { channels: wrapped, sampleRate, length: loopFrames, duration: loopFrames / sampleRate,
		numberOfChannels: wrapped.length,
		getChannelData(channel: number): Float32Array {
			const samples = wrapped[channel];
			if (!samples) throw new RangeError('Loop render channel is out of range.');
			return samples;
		},
	};
}
