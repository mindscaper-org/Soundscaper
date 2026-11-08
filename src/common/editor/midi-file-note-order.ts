/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiPortTickEvent } from './midi-file-port-events.ts';

interface NoteRelease {
	readonly tick: number;
	readonly velocity: number;
}
interface KeyQueue {
	readonly releases: NoteRelease[];
	next: number;
}

/** Refuse note-off streams that would reassign an authored voice's release. */
export function createMidiFileNoteOrderGuard() {
	const notes = new WeakMap<MidiPortTickEvent, NoteRelease>();
	const channels = new Map<string, Map<number, KeyQueue>>();
	let port = 0;
	let device = '';
	return {
		register(on: MidiPortTickEvent, off: MidiPortTickEvent): void {
			const release = { tick: off.tick, velocity: off.data[1]! };
			notes.set(on, release);
			notes.set(off, release);
		},
		observe(event: MidiPortTickEvent): void {
			if (event.status === 255 && event.metaType === 9) device = JSON.stringify(event.data);
			else if (event.status === 255 && event.metaType === 0x21 && event.data.length === 1) port = event.data[0]!;
			const type = event.status & 240;
			const destination = `${device}:${String(port)}:${String(event.status & 15)}`;
			if (type === 176 && [120, 123, 124, 125, 126, 127].includes(event.data[0]!)) {
				channels.delete(destination);
				return;
			}
			const release = notes.get(event);
			if (!release) return;
			const pitch = event.data[0]!;
			if (type === 144) {
				const keys = channels.get(destination) ?? new Map<number, KeyQueue>();
				const queue = keys.get(pitch) ?? { releases: [], next: 0 };
				queue.releases.push(release);
				keys.set(pitch, queue);
				channels.set(destination, keys);
			} else if (type === 128) {
				const keys = channels.get(destination);
				const queue = keys?.get(pitch);
				const expected = queue?.releases[queue.next];
				if (!queue || !expected) return;
				if (expected.tick !== release.tick || expected.velocity !== release.velocity) {
					throw new RangeError('MIDI export cannot preserve overlapping notes on the same MIDI key. Export Allegro or save the native project.');
				}
				queue.next += 1;
				if (queue.next === queue.releases.length) keys?.delete(pitch);
				if (keys?.size === 0) channels.delete(destination);
			}
		},
	};
}
