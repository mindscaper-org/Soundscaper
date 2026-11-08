/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiClipData, MidiTrackData } from '../midi-model.ts';
import type { AudioWarpMap } from '../audio-warp-domain.ts';
import type { Rational } from '../timeline-time.ts';
import { defineDomainCommandHandlerRegistry, type DomainCommandHandlerRegistry } from './domain-registry.ts';

export const MIDI_COMMAND_TYPES = ['midi/clip-set', 'midi/track-set'] as const;
export type MidiCommandType = typeof MIDI_COMMAND_TYPES[number];
export type MidiCommandHandlers = DomainCommandHandlerRegistry<typeof MIDI_COMMAND_TYPES>;

export interface MidiCommandPayloads {
	readonly 'midi/clip-set': Readonly<{
		clipId: string;
		data: MidiClipData;
		sourceId: string;
		sourceDurationFrames: number;
		durationFrames?: number;
		warpMap?: Readonly<AudioWarpMap>;
		musicalDurationBeats?: Rational;
	}>;
	readonly 'midi/track-set': Readonly<{ trackId: string; data: MidiTrackData }>;
}

export function defineMidiCommandHandlers(handlers: MidiCommandHandlers): Readonly<MidiCommandHandlers> {
	return defineDomainCommandHandlerRegistry('midi', MIDI_COMMAND_TYPES, handlers);
}
