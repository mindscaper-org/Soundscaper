/* SPDX-License-Identifier: AGPL-3.0-only */
import { MidiDemandSource } from '../engine/midi-demand-source.ts';
import { openThreadedMidiRenderer } from '../engine/midi-threaded-renderer.ts';
import type { StorageRecord } from './media-records.ts';
import type { MidiSourceRecipe } from './midi-source.ts';

export interface MidiPcmReadView {
	readonly maximumConcurrentReads: 1;
	chunk(index: number, signal?: AbortSignal): ReturnType<MidiDemandSource['chunk']>;
	release(): Promise<void>;
}
interface Entry { readonly sourceId: string; readonly renderer: MidiDemandSource; readers: number; timer?: ReturnType<typeof setTimeout> }

/** Store-local immutable cache, bounded to 32 MiB. Active reads own their synthesis lifetime. */
export class MidiSourceRuntime {
	readonly #entries = new Map<string, Entry>();
	open(source: StorageRecord): MidiPcmReadView {
		const key = String(source.sourceToken);
		let entry = this.#entries.get(key);
		if (!entry) {
			const recipe = source.midiRecipe as MidiSourceRecipe;
			entry = { sourceId: String(source.id), readers: 0, renderer: new MidiDemandSource({
				frameCount: Number(source.frameCount), channelCount: Number(source.channelCount), chunkFrames: Number(source.chunkFrames),
			}, () => openThreadedMidiRenderer(recipe.data, recipe.instrument, recipe.sampleRate), 1024 * 1024) };
			this.#entries.set(key, entry);
		}
		if (entry.timer) clearTimeout(entry.timer);
		entry.readers++;
		const current = entry;
		let released = false;
		return { maximumConcurrentReads: 1, chunk: async (index, signal) => {
			if (released) throw new Error('MIDI source read session was released.');
			const chunk = await current.renderer.chunk(index, signal);
			this.#entries.delete(key); this.#entries.set(key, current);
			let bytes = [...this.#entries.values()].reduce((sum, value) => sum + value.renderer.cachedBytes, 0);
			for (const value of this.#entries.values()) {
				if (bytes <= 32 * 1024 * 1024) break;
				bytes -= value.renderer.cachedBytes; value.renderer.clearCache();
			}
			return chunk;
		}, release: async () => {
			if (released) return;
			released = true; current.readers--;
			if (!current.readers) current.timer = setTimeout(() => { void current.renderer.suspend().catch(() => undefined); }, 250);
			for (const [oldKey, old] of this.#entries) {
				if (this.#entries.size <= 32) break;
				if (old.readers) continue;
				this.#entries.delete(oldKey); if (old.timer) clearTimeout(old.timer);
				await old.renderer.close();
			}
		} };
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
