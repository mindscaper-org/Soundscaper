/* SPDX-License-Identifier: AGPL-3.0-only */

import { dialogueSourceAtOutput, validateDialoguePcm, type DialogueAlignment } from './dialogue-alignment.ts';
import type { StaffPadWasmRuntime } from './staffpad/wasm-instance.ts';

/** One continuous pitch-preserving session keeps stereo channels on the same clock. */
export function renderAlignedDialogue(channels: readonly Float32Array[], sampleRate: number,
	alignment: DialogueAlignment, runtime: StaffPadWasmRuntime): Float32Array[] {
	validateDialoguePcm(channels, sampleRate);
	if (alignment.inputFrames !== channels[0]!.length || !Number.isSafeInteger(alignment.outputFrames)
		|| alignment.outputFrames < sampleRate * .25 || alignment.outputFrames > sampleRate * 30) throw new RangeError('Invalid dialogue render extent.');
	if (alignment.inputFrames === alignment.outputFrames && alignment.points.every(point => point.sourceFrame === point.outputFrame)) return channels.map(channel => channel.slice());
	const output = channels.map(() => new Float32Array(alignment.outputFrames));
	const session = runtime.createSession(sampleRate, channels.length, true);
	const timeRatioAt = (frame: number): number => {
		const start = Math.max(0, frame - sampleRate * .01), end = Math.min(alignment.outputFrames, frame + sampleRate * .01);
		const source = dialogueSourceAtOutput(alignment, end) - dialogueSourceAtOutput(alignment, start);
		return Math.max(.5, Math.min(2, (end - start) / source));
	};
	let cursor = 0, sourceOffset = 0;
	try {
		session.setParameters(timeRatioAt(0), 1);
		let discard = session.latency(timeRatioAt(0));
		const maximumInput = alignment.inputFrames + sampleRate * 4;
		while (cursor < alignment.outputFrames) {
			const available = session.availableOutput();
			if (available > 0) {
				const chunk = session.read(Math.min(available, runtime.maximumBlockSize));
				const skip = Math.min(discard, chunk[0]!.length); discard -= skip;
				const count = Math.min(chunk[0]!.length - skip, alignment.outputFrames - cursor);
				for (let channel = 0; channel < channels.length; channel++) output[channel]!.set(chunk[channel]!.subarray(skip, skip + count), cursor);
				cursor += count;
			} else {
				const required = session.requiredInput();
				if (required <= 0 || sourceOffset > maximumInput) throw new RangeError('Dialogue stretching exceeded its bounded input flush.');
				const frames = Math.min(required, runtime.maximumBlockSize);
				session.setParameters(timeRatioAt(cursor), 1);
				session.feed(channels, sourceOffset, frames); sourceOffset += frames;
			}
		}
		return output;
	} finally { session.destroy(); }
}
