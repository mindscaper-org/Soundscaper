/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeMidiFile } from '../../src/common/editor/midi-file.ts';

export function denseMidiScoreFixture(): Uint8Array<ArrayBuffer> {
	const notes = Array.from({ length: 25_000 }, (_, index) => ({ id: `note-${index}`,
		startFrame: Math.floor(index / 25) * 48, durationFrames: 19, channel: 1, midiPort: 2, pitch: 48 + index % 25,
		velocity: 81, releaseVelocity: 37 }));
	return writeMidiFile({ sampleRate: 48_000, tempos: [], signatures: [], tracks: [{ name: 'Dense score', notes,
		events: [{ frame: 0, status: 255, metaType: 33, data: [2] }, { frame: 0, status: 177, data: [7, 100] }] }] });
}
