/* SPDX-License-Identifier: AGPL-3.0-only */
import { MidiDemandSource } from '../engine/midi-demand-source.ts';
import { openThreadedMidiRenderer } from '../engine/midi-threaded-renderer.ts';
import type { StorageRecord } from './media-records.ts';
import type { MidiSourceRecipe } from './midi-source.ts';

export interface MidiPcmReadView {
	readonly maximumConcurrentReads: 1;
	chunk(index: number, signal?: AbortSignal, renderStartFrame?: number): ReturnType<MidiDemandSource['chunk']>;
	release(): Promise<void>;
}
interface Entry { readonly sourceId: string; readonly renderer: MidiDemandSource; readers: number; timer?: ReturnType<typeof setTimeout> }

/** Cache live seek origins separately from canonical export PCM. Never reuse chased voices in an export. */
export class MidiSourceRuntime {
	readonly #entries = new Map<string, Entry>();
	open(source: StorageRecord): MidiPcmReadView {
		let released = false;
		return { maximumConcurrentReads: 1, chunk: async (index, signal, renderStartFrame) => {
			if (released) throw new Error('MIDI source read session was released.');
			const origin = renderStartFrame === undefined ? 0 : Math.floor(renderStartFrame / Number(source.chunkFrames)) * Number(source.chunkFrames);
			if (!Number.isSafeInteger(origin) || origin < 0) throw new RangeError('Invalid MIDI playback origin.');
			const key = `${source.sourceToken}:${origin}`;
			let entry = this.#entries.get(key);
			if (!entry) {
				const recipe = source.midiRecipe as MidiSourceRecipe;
				entry = { sourceId: String(source.id), readers: 0, renderer: new MidiDemandSource({
					frameCount: Number(source.frameCount), channelCount: Number(source.channelCount), chunkFrames: Number(source.chunkFrames),
				}, () => openThreadedMidiRenderer(recipe.data, recipe.instrument, recipe.sampleRate, undefined, origin, Number(source.channelCount)), 1024 * 1024) };
			}
			const current = entry;
			this.#entries.delete(key); this.#entries.set(key, current);
			if (current.timer) clearTimeout(current.timer);
			current.readers++;
			try {
				const chunk = await current.renderer.chunk(index, signal);
				this.#trim(); return chunk;
			} finally {
				current.readers--;
				if (!current.readers) current.timer = setTimeout(() => { void current.renderer.suspend().catch(() => undefined); }, 250);
			}
		}, release: async () => { released = true; } };
	}
	#trim(): void {
		let bytes = [...this.#entries.values()].reduce((sum, value) => sum + value.renderer.cachedBytes, 0);
		for (const [key, entry] of this.#entries) {
			if (bytes > 32 * 1024 * 1024) { bytes -= entry.renderer.cachedBytes; entry.renderer.clearCache(); }
			if (this.#entries.size <= 32 || entry.readers) continue;
			this.#entries.delete(key); if (entry.timer) clearTimeout(entry.timer);
			void entry.renderer.close().catch(() => undefined);
		}
	}
	async release(sourceIds?: ReadonlySet<string>): Promise<void> {
		const closing: Promise<void>[] = [];
		for (const [key, entry] of this.#entries) {
			if (sourceIds && !sourceIds.has(entry.sourceId)) continue;
			this.#entries.delete(key); if (entry.timer) clearTimeout(entry.timer);
			closing.push(entry.renderer.close());
		}
		await Promise.all(closing);
	}
}
