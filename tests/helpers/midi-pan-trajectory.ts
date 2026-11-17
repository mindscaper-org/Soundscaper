/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiFileDocument } from '../../src/common/editor/midi-file-types.ts';

export function midiPanTrajectory(initialPan: number | null = 0): MidiFileDocument {
	return { sampleRate: 8000, tempos: [], signatures: [], tracks: [{ name: 'Left then right', durationFrames: 16000,
		notes: [0, 8000].map((startFrame, index) => ({ id: `note-${String(index)}`, pitch: 67, channel: 0, velocity: 100, startFrame, durationFrames: 6000 })),
		events: [{ frame: 0, status: 0xc0, data: [40] }, ...(initialPan === null ? [] : [{ frame: 0, status: 0xb0, data: [10, initialPan] }]), { frame: 8000, status: 0xb0, data: [10, 127] }],
	}] };
}

export function channelEnergy(channel: Float32Array, from: number, end: number): number {
	return channel.subarray(from, end).reduce((sum, sample) => sum + sample * sample, 0);
}
