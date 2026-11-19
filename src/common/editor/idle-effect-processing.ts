/* SPDX-License-Identifier: AGPL-3.0-only */

const USEFUL_OUTPUT = 1e-6; // -120 dBFS; input must be exactly silent.
export const IDLE_EFFECT_CONTROL_MESSAGE = 'suspend-idle-effect-processing';

/** Audio-thread silence gate. It never ends the processor's Web Audio lifetime. */
export class IdleEffectGate {
	private enabled = true;
	private inputQuietFrames = 0;
	private outputQuietFrames = 0;
	private receivedInput = false;
	private suspended = false;
	private readonly quietFrames: number;
	private readonly sharedControl?: Int32Array;

	constructor(sampleRate: number, private holdFrames: number, private readonly reset: () => void,
		sharedControl?: SharedArrayBuffer) {
		this.quietFrames = Math.ceil(sampleRate * 0.25);
		if (sharedControl) this.sharedControl = new Int32Array(sharedControl);
	}

	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) return;
		this.enabled = enabled;
		this.wake();
	}

	/** Edits must run even while idle; retain the longest outstanding tail on shrink. */
	wake(holdFrames = this.holdFrames): void {
		this.holdFrames = Math.max(this.holdFrames, holdFrames);
		this.inputQuietFrames = 0;
		this.outputQuietFrames = 0;
		this.suspended = false;
		this.receivedInput = true;
	}

	handleMessage(message: Readonly<{ type?: unknown; enabled?: unknown }>): boolean {
		if (message.type !== IDLE_EFFECT_CONTROL_MESSAGE) return false;
		this.setEnabled(message.enabled !== false);
		return true;
	}

	before(inputs: readonly (readonly Float32Array[])[], output: readonly Float32Array[], frames: number): boolean {
		const enabled = this.sharedControl ? Atomics.load(this.sharedControl, 0) !== 0 : this.enabled;
		if (!enabled) { this.wake(); return true; }
		if (!Number.isFinite(this.holdFrames)) return true;
		for (const input of inputs) for (const channel of input) {
			for (let frame = 0; frame < frames; frame++) if (channel[frame] !== 0) {
				this.inputQuietFrames = 0;
				this.outputQuietFrames = 0;
				this.receivedInput = true;
				this.suspended = false;
				return true;
			}
		}
		const hold = this.receivedInput ? Math.max(this.quietFrames, this.holdFrames) : this.quietFrames;
		// Tails can contain silence between repeats. Reserve the full hold after
		// useful output too, rather than mistaking an echo gap for a drained buffer.
		if (this.inputQuietFrames >= hold && this.outputQuietFrames >= hold) {
			if (!this.suspended) { this.reset(); this.suspended = true; }
			for (const channel of output) channel.fill(0, 0, frames);
			return false;
		}
		this.inputQuietFrames += frames;
		return true;
	}

	after(output: readonly Float32Array[], frames: number): void {
		if (!(this.sharedControl ? Atomics.load(this.sharedControl, 0) !== 0 : this.enabled) || !Number.isFinite(this.holdFrames)) return;
		for (const channel of output) for (let frame = 0; frame < frames; frame++) {
			const sample = channel[frame]!;
			if (!Number.isFinite(sample) || Math.abs(sample) > USEFUL_OUTPUT) {
				this.outputQuietFrames = 0;
				return;
			}
		}
		this.outputQuietFrames += frames;
	}
}
