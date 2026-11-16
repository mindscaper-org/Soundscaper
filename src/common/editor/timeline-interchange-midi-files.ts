/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseMidiFile } from './midi-file.ts';
import { midiFileImportTracks } from './midi-file-import-tracks.ts';
import { normalizeMidiClipData, type MidiClipData } from './midi-model.ts';
import { divideRationals } from './timeline-time.ts';
import { timelineImportIssue, type TimelineInterchangeDocument, type TimelineInterchangeTrack, type TimelineInterchangeClip } from './timeline-interchange-types.ts';

/** File-owned MIDI clocks and SMF track identities survive a containing edit list. */
export function expandTimelineInterchangeMidiFiles(document: TimelineInterchangeDocument, bytes: ReadonlyMap<string, Uint8Array> = new Map()): TimelineInterchangeDocument {
	const media = new Map(document.media.map(item => [item.id, item]));
	const attachments = new Map(document.midiAttachments?.map(item => [item.trackId, item]));
	const parsed = new Map<string, readonly { name: string; durationFrames: number; data: MidiClipData }[]>();
	const issues = [...document.issues];
	const read = (id: string) => {
		if (parsed.has(id)) return parsed.get(id)!;
		const data = bytes.get(id);
		if (!data) return null;
		const file = parseMidiFile(data, { sampleRate: document.sampleRate });
		const reference = media.get(id);
		if (reference) media.set(id, { ...reference, duration: divideRationals(Math.max(1, ...file.tracks.map(track => track.durationFrames ?? 0)), document.sampleRate) });
		const tracks = midiFileImportTracks(file).map(track => ({ name: track.name, durationFrames: track.durationFrames,
			data: normalizeMidiClipData({ version: 1, notes: track.notes, interchange: { events: track.events ?? [], tempos: file.tempos, signatures: file.signatures } }) }));
		parsed.set(id, tracks);
		return tracks;
	};
	const tracks = document.tracks.flatMap(track => {
		const attachment = attachments.get(track.id);
		if (attachment) {
			const parts = read(attachment.mediaId);
			if (!parts) {
				issues.push(timelineImportIssue(document.format, 'midi-attachment-missing', 'The MIDI attachment is unavailable; an empty MIDI track and offline source are retained without inventing note timing.', 'missing'));
				return [track];
			}
			return parts.map((part, index) => ({ ...track, id: `${track.id}:${index}`, name: part.name || attachment.name,
				clips: [{ id: `${track.id}:clip:${index}`, name: part.name || attachment.name, mediaId: attachment.mediaId,
					start: { num: 0, den: 1 }, sourceStart: { num: 0, den: 1 }, duration: divideRationals(Math.max(1, part.durationFrames), document.sampleRate), midi: part.data }] }));
		}
		const regular: TimelineInterchangeClip[] = [], lanes = new Map<string, { track: TimelineInterchangeTrack; clips: TimelineInterchangeClip[] }>();
		for (const clip of track.clips) {
			const reference = media.get(clip.mediaId);
			if (track.kind !== 'audio' || clip.midi || clip.midiFileTiming || !reference?.midi && !bytes.has(clip.mediaId)) { regular.push(clip); continue; }
			const parts = read(clip.mediaId);
			for (const [index, part] of (parts ?? [null]).entries()) {
				const key = `${clip.mediaId}:${index}`;
				let lane = lanes.get(key);
				if (!lane) {
					const clips: TimelineInterchangeClip[] = [];
					lane = { clips, track: { ...track, id: `${track.id}:midi:${key}`, midi: true,
						name: parts && parts.length > 1 ? `${track.name} / ${part?.name ?? index + 1}` : track.name, clips } };
					lanes.set(key, lane);
				}
				lane.clips.push({ ...clip, id: `${clip.id}:${index}`, ...(part ? { midi: part.data } : {}) });
			}
		}
		return [...(regular.length || !lanes.size ? [{ ...track, clips: regular }] : []), ...[...lanes.values()].map(lane => lane.track)];
	});
	if (parsed.size) issues.push(timelineImportIssue(document.format, 'midi-file-clock-converted',
		'MIDI files use their own tempo and SMPTE clocks for note timing. Tempo and meter maps remain in clip metadata; the project musical clock is unchanged.', 'converted'));
	return { ...document, tracks, media: [...media.values()], issues };
}
