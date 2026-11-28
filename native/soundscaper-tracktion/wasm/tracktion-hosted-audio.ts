/* SPDX-License-Identifier: AGPL-3.0-only */

import { TRACKTION_BLOCK_FRAMES, TracktionAudioQueue, type TracktionAudioBuffers } from '../../../src/soundscaper/tracktion-audio-queue.ts';
import { TracktionCaptureQueue } from '../../../src/soundscaper/tracktion-capture-queue.ts';

export interface HostedAudioRuntime {
	HEAPU8: Uint8Array;
	_malloc(size: number): number;
	_free(pointer: number): void;
	_soundscaper_read_playback(output: number, input: number, frames: number): number;
}

const burstBlocks = 16;
const outputSamples = TRACKTION_BLOCK_FRAMES * 2;
const waitForWorker = () => new Promise<void>((resolve) => setTimeout(resolve, 4));

export class TracktionHostedAudio {
	readonly #runtime: HostedAudioRuntime;
	readonly #output: TracktionAudioQueue;
	readonly #capture: TracktionCaptureQueue | undefined;
	readonly #pointer: number;
	#timer: ReturnType<typeof setInterval> | undefined;

	constructor(runtime: HostedAudioRuntime, buffers: TracktionAudioBuffers) {
		this.#runtime = runtime;
		this.#output = new TracktionAudioQueue(buffers.output);
		this.#capture = buffers.capture && new TracktionCaptureQueue(buffers.capture);
		this.#pointer = runtime._malloc((outputSamples + (this.#capture ? TRACKTION_BLOCK_FRAMES : 0)) * Float32Array.BYTES_PER_ELEMENT);
		if (!this.#pointer) throw new Error('Tracktion ran out of audio memory');
	}

	start(): void {
		this.#timer = setInterval(() => this.#produce(), 4);
		this.#produce();
	}

	pause(): void { clearInterval(this.#timer); }

	async drain(): Promise<void> {
		const capture = this.#capture;
		if (!capture) return;
		this.pause();
		capture.seal();
		while (!capture.sealed || capture.readableFrames()) {
			this.#produce();
			if (!capture.sealed || capture.readableFrames()) await waitForWorker();
		}
	}

	stop(): void {
		this.pause();
		this.#runtime._free(this.#pointer);
	}

	#produce(): void {
		const capture = this.#capture;
		const { buffer } = this.#runtime.HEAPU8;
		const output = new Float32Array(buffer, this.#pointer, outputSamples);
		const inputPointer = capture ? this.#pointer + outputSamples * Float32Array.BYTES_PER_ELEMENT : 0;
		const input = capture && new Float32Array(buffer, inputPointer, TRACKTION_BLOCK_FRAMES);
		const blocks = capture ? burstBlocks : this.#output.writableBlocks();
		for (let block = 0; block < blocks; block += 1) {
			const frames = capture ? Math.min(capture.readableFrames(), TRACKTION_BLOCK_FRAMES) : TRACKTION_BLOCK_FRAMES;
			if (frames === 0 || (frames < TRACKTION_BLOCK_FRAMES && !capture?.sealed)) return;
			if (capture && input) capture.peek(input, frames);
			if (!this.#runtime._soundscaper_read_playback(this.#pointer, inputPointer, frames)) return;
			capture?.consume(frames);
			if (frames === TRACKTION_BLOCK_FRAMES && this.#output.writableBlocks()) this.#output.writeBlock(output);
		}
	}
}
