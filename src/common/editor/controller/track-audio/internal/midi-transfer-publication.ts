/* SPDX-License-Identifier: AGPL-3.0-only */
import { readMidiClip, readMidiTrack } from '../../../midi-model.ts';
import { createAddSourceCommand } from '../../../commands/factories.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import type { AudioSourceLeaf } from '../../../project-media-types.ts';
import type { MidiServiceDependencies, MidiTransferSnapshot } from '../midi-service-types.ts';
import { publishMidiSource } from './midi-source-publication.ts';
import { retainedMidiSourceFrames } from './midi-source-retention.ts';

/** Rebuild a transferred carrier only when its new owner cannot reuse its old audible instrument. */
export async function prepareMidiTransferPublication(
	dependencies: MidiServiceDependencies, before: MidiTransferSnapshot, after: MidiTransferSnapshot,
	assertCurrent: () => void, retained: AudioSourceLeaf[],
): Promise<readonly AudioEditorCommand[]> {
	const oldClips = new Map(before.clips.map(clip => [clip.id, clip]));
	const owners = (project: MidiTransferSnapshot) => {
		const result = new Map<string, ReturnType<typeof readMidiTrack>>();
		for (const track of project.tracks) for (const id of track.clipIds ?? []) result.set(id, readMidiTrack(track));
		return result;
	};
	const oldOwners = owners(before), newOwners = owners(after);
	const sources = new Map(after.sources?.map(source => [source.id, source]));
	const commands: AudioEditorCommand[] = [];
	for (const clip of after.clips) {
		const data = readMidiClip(clip), owner = newOwners.get(clip.id);
		if (!data || !owner) continue;
		const old = oldClips.get(clip.id);
		if (old && old.sourceId === clip.sourceId && JSON.stringify(oldOwners.get(clip.id)?.instrument) === JSON.stringify(owner.instrument)) continue;
		const source = typeof clip.sourceId === 'string' ? sources.get(clip.sourceId) : undefined;
		if (source?.kind !== 'audio' || !Number.isSafeInteger(source.sampleRate) || Number(source.sampleRate) < 1
			|| !Number.isSafeInteger(source.frameCount) || Number(source.frameCount) < 1) {
			throw new RangeError('Transferred MIDI requires its complete native audio source.');
		}
		const replacement = await publishMidiSource(dependencies, data, owner.instrument,
			Number(source.sampleRate), retainedMidiSourceFrames(source, 1), assertCurrent);
		retained.push(replacement);
		commands.push(createAddSourceCommand({ ...replacement }), { type: 'midi/clip-set', clipId: clip.id,
			data, sourceId: replacement.id, sourceDurationFrames: Number(clip.sourceDurationFrames) });
	}
	return commands;
}
