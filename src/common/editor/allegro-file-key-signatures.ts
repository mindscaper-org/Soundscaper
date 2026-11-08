/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiFileEvent } from './midi-file-types.ts';

export interface AllegroKeyPart {
	readonly track: number;
	readonly frame: number;
	readonly key?: number;
	readonly minor?: boolean;
	readonly positionId?: string;
}

/** PortSMF consumes key parts in each track's event order, clearing completed pairs. */
export function allegroKeySignatures(parts: readonly AllegroKeyPart[]): readonly Readonly<{ track: number; event: MidiFileEvent; positionId?: string }>[] {
	const result: { track: number; event: MidiFileEvent; positionId?: string }[] = [];
	let key: number | undefined, minor: boolean | undefined;
	for (const part of [...parts].sort((left, right) => left.track - right.track || left.frame - right.frame)) {
		if (part.key !== undefined) key = part.key;
		if (part.minor !== undefined) minor = part.minor;
		if (key !== undefined && minor !== undefined) {
			result.push({ track: part.track, ...(part.positionId ? { positionId: part.positionId } : {}), event: { frame: part.frame, status: 255, metaType: 89, data: [key & 255, minor ? 1 : 0] } });
			key = undefined; minor = undefined;
		}
	}
	if (key !== undefined || minor !== undefined) throw new RangeError('Unmatched Allegro key signature parts cannot be retained. Supply both key and mode.');
	return result;
}
