/* SPDX-License-Identifier: AGPL-3.0-only */
/* global AudioWorkletProcessor, currentFrame, sampleRate, registerProcessor */

// Measure every 256-frame window on the render thread. A delayed main-thread
// observer must not manufacture silent blocks in otherwise continuous audio.
class LiveOutputObserver extends AudioWorkletProcessor {
	frames = 0;
	powers = [];
	peak = 0;
	process(inputs) {
		const channels = inputs[0], samples = channels?.[0];
		if (!samples) return true;
		for (let index = 0; index < samples.length; index++) {
			for (let channel = 0; channel < channels.length; channel++) {
				this.powers[channel] = (this.powers[channel] ?? 0) + channels[channel][index] ** 2;
			}
			this.peak = Math.max(this.peak, Math.abs(samples[index]));
			if (++this.frames === 256) {
				const rms = this.powers.map(power => Math.sqrt(power / 256));
				this.port.postMessage({ time: (currentFrame + index + 1) / sampleRate, rms: rms[0], channels: rms, peak: this.peak });
				this.frames = 0;
				this.powers.fill(0);
				this.peak = 0;
			}
		}
		return true;
	}
}
registerProcessor('test-live-output-observer', LiveOutputObserver);
