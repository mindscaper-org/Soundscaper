/* SPDX-License-Identifier: AGPL-3.0-only */
import { raceAbortableRead } from '../../foundation/abort-race.ts';

export interface MidiAudioRenderer {
	readonly channelCount: number;
	render(start: number, frames: number): Promise<Float32Array<ArrayBuffer>[]>;
	close(): Promise<void>;
}
interface Geometry { readonly frameCount: number; readonly channelCount: number; readonly chunkFrames: number }

/** Immutable-source PCM cache. Only demanded windows are synthesized; the UI never runs DSP. */
export class MidiDemandSource {
	readonly #geometry: Geometry;
	readonly #open: () => Promise<MidiAudioRenderer>;
	readonly #limit: number;
	readonly #cache = new Map<number, Float32Array<ArrayBuffer>[]>();
	#bytes = 0;
	#renderer: MidiAudioRenderer | null = null;
	#pending: Promise<unknown> = Promise.resolve();
	#closed = false;
	#closing: Promise<void> | null = null;
	constructor(geometry: Geometry, open: () => Promise<MidiAudioRenderer>, maximumBytes = 4 * 1024 * 1024) {
		if (![geometry.frameCount, geometry.channelCount, geometry.chunkFrames, maximumBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new RangeError('Invalid MIDI demand-source geometry.');
		this.#geometry = geometry; this.#open = open; this.#limit = maximumBytes;
	}
	get cachedBytes(): number { return this.#bytes; }
	clearCache(): void { this.#cache.clear(); this.#bytes = 0; }
	suspend(): Promise<void> {
		const work = this.#pending.then(async () => { await this.#renderer?.close(); this.#renderer = null; });
		this.#pending = work.catch(() => undefined);
		return work;
	}
	chunk(index: number, signal?: AbortSignal) {
		const request = async () => {
			signal?.throwIfAborted();
			if (this.#closed) throw new Error('MIDI demand source is closed.');
			const { frameCount, chunkFrames, channelCount } = this.#geometry;
			const start = index * chunkFrames, frames = Math.min(chunkFrames, frameCount - start);
			if (!Number.isSafeInteger(index) || index < 0 || frames <= 0) throw new RangeError('MIDI source chunk does not exist.');
			let channels = this.#cache.get(index);
			if (!channels) {
				this.#renderer ??= await this.#open();
				channels = await this.#renderer.render(start, frames);
				if (channels.length !== channelCount || channels.some(plane => plane.length !== frames || plane.some(value => !Number.isFinite(value)))) throw new Error('MIDI instrument returned invalid PCM.');
				const bytes = frames * channelCount * Float32Array.BYTES_PER_ELEMENT;
				while (this.#bytes + bytes > this.#limit && this.#cache.size) {
					const oldest = this.#cache.keys().next().value!;
					this.#bytes -= this.#cache.get(oldest)!.reduce((total, plane) => total + plane.byteLength, 0);
					this.#cache.delete(oldest);
				}
				if (bytes <= this.#limit && !this.#closed) { this.#cache.set(index, channels); this.#bytes += bytes; }
			} else { this.#cache.delete(index); this.#cache.set(index, channels); }
			signal?.throwIfAborted();
			if (this.#closed) throw new Error('MIDI demand source is closed.');
			return { index, frames, channels: channels.map(plane => plane.slice()) };
		};
		const work = this.#pending.then(request);
		this.#pending = work.catch(() => undefined);
		return raceAbortableRead(() => work, signal, 'immediate');
	}
	close(): Promise<void> {
		this.#closed = true;
		this.#closing ??= this.#pending.then(async () => {
			this.#cache.clear(); this.#bytes = 0;
			await this.#renderer?.close(); this.#renderer = null;
		});
		return this.#closing;
	}
}
