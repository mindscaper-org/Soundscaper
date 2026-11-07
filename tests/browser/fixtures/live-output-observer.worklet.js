/* SPDX-License-Identifier: AGPL-3.0-only */
/* global AudioWorkletProcessor, currentFrame, sampleRate, registerProcessor */

// Measure every 256-frame window on the render thread. A delayed main-thread
// observer must not manufacture silent blocks in otherwise continuous audio.
class LiveOutputObserver extends AudioWorkletProcessor {
	frames = 0;
	power = 0;
	peak = 0;
	process(inputs) {
		const samples = inputs[0]?.[0];
		if (!samples) return true;
		for (let index = 0; index < samples.length; index++) {
			this.power += samples[index] ** 2;
			this.peak = Math.max(this.peak, Math.abs(samples[index]));
			if (++this.frames === 256) {
				this.port.postMessage({ time: (currentFrame + index + 1) / sampleRate, rms: Math.sqrt(this.power / 256), peak: this.peak });
				this.frames = 0;
				this.power = 0;
				this.peak = 0;
			}
		}
		return true;
	}
}
registerProcessor('test-live-output-observer', LiveOutputObserver);
