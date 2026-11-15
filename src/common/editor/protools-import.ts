/* SPDX-License-Identifier: AGPL-3.0-only */

import { divideRationals } from './timeline-time.ts';
import { readProToolsContainer } from './protools-binary.ts';
import { readProToolsAudioFiles, readProToolsRegions } from './protools-audio.ts';
import { readProToolsTracks } from './protools-tracks.ts';
import { timelineImportIssue, timelineInterchangeMediaName, type TimelineInterchangeDocument, type TimelineInterchangeMedia,
	type TimelineInterchangeTrack, type TimelineInterchangeClip } from './timeline-interchange-types.ts';

/** Import audio edits from the native PTS/PTF/PTX block layouts, without loading Avid code. */
export function parseProToolsDocument(bytes: Uint8Array, options: Readonly<{ fileName?: string }> = {}): TimelineInterchangeDocument {
	const container = readProToolsContainer(bytes), { reader, blocks, version } = container;
	const rateRecords = blocks.filter(block => block.kind === 0x1028);
	if (rateRecords.length !== 1) throw new SyntaxError('A Pro Tools session requires one sample rate record.');
	const record = rateRecords[0]!, sampleRate = reader.uint(record.offset + 4, 4, record.end);
	if (sampleRate < 8000 || sampleRate > 768000) throw new RangeError('Unsupported Pro Tools sample rate.');
	const seconds = (samples: number) => divideRationals(samples, sampleRate);
	const files = readProToolsAudioFiles(container), regions = readProToolsRegions(container);
	const lanes = readProToolsTracks(container, regions);
	const issues: TimelineInterchangeDocument['issues'][number][] = [
		timelineImportIssue('protools', 'session-read', 'Native Pro Tools audio session blocks were read.', 'preserved', { version, bigEndian: reader.bigEndian }),
		timelineImportIssue('protools', 'mix-settings-omitted', 'Pro Tools gain, pan, mute/solo, plug-ins, automation and routing are not imported. Audio cuts use neutral controls.'),
		timelineImportIssue('protools', 'tempo-markers-omitted', 'Pro Tools tempo, meter and marker authoring is not imported.'),
		timelineImportIssue('protools', 'fades-omitted', 'Pro Tools fades and crossfades are not imported; rendered fade regions are omitted.'),
		timelineImportIssue('protools', 'sequence-clock-converted', 'Sample placement is retained; the sequence clock uses 30 fps with a zero timecode origin.', 'converted'),
	];
	const media = new Map<string, TimelineInterchangeMedia>();
	const tracks: TimelineInterchangeTrack[] = [];
	for (const lane of lanes) {
		const clips: TimelineInterchangeClip[] = [];
		for (const [index, placement] of lane.placements.entries()) {
			if (placement.fade) continue;
			const region = regions[placement.regionIndex];
			if (!region || !region.duration) {
				issues.push(timelineImportIssue('protools', 'region-omitted', 'An unsupported, missing or empty region cannot be reconstructed; other clip positions are retained.', 'omitted',
					{ lane: lane.index, regionIndex: placement.regionIndex, startSample: placement.start }));
				continue;
			}
			const file = files[region.sourceIndex], id = `source:${region.sourceIndex}`;
			if (!media.has(id)) {
				media.set(id, { id, name: file ? timelineInterchangeMediaName(file.name) : `Missing Pro Tools source ${region.sourceIndex}`,
					path: file ? audioPath(file.name) : '', kind: 'audio', ...(file ? { aliases: [file.name] } : {}),
					...(file?.frames ? { duration: seconds(file.frames) } : {}) });
				if (!file) issues.push(timelineImportIssue('protools', 'source-reference-missing', 'A region references an absent audio file table entry; its offline edit is retained.', 'missing', { sourceIndex: region.sourceIndex }));
			}
			clips.push({ id: `lane:${lane.index}:clip:${index}`, name: region.name, mediaId: id, start: seconds(placement.start),
				sourceStart: seconds(region.sourceStart), duration: seconds(region.duration) });
		}
		if (lane.channelCount > 1) issues.push(timelineImportIssue('protools', 'channel-lanes-converted', 'Track channel lanes become separate audio tracks; stereo lanes are hard-panned left and right.', 'converted', { lane: lane.index, channels: lane.channelCount }));
		tracks.push({ id: `lane:${lane.index}`, name: lane.name + (lane.channelCount === 2 ? lane.channel === 0 ? ' (L)' : ' (R)' : lane.channelCount > 2 ? ` (${lane.channel + 1})` : ''),
			kind: 'audio', clips, pan: lane.channelCount === 2 ? lane.channel === 0 ? -1 : 1 : 0 });
	}
	if (blocks.some(block => [0x2000, 0x1058, 0x2634, 0x2002].includes(block.kind))) issues.push(timelineImportIssue('protools', 'midi-omitted', 'MIDI tracks, notes and instruments are not imported.'));
	if (reader.legacyStrings) issues.push(timelineImportIssue('protools', 'legacy-text-converted', 'Legacy names were decoded using the session platform character set.', 'converted'));
	const title = options.fileName?.split(/[\\/]/u).at(-1)?.replace(/\.[^.]+$/u, '') || 'Pro Tools session';
	return { format: 'protools', title, sampleRate, rate: { num: 30, den: 1 }, dropFrame: false, startFrameCount: 0,
		tracks, media: [...media.values()], issues };
}

function audioPath(name: string): string { return /[\\/]/u.test(name) ? name : `Audio Files/${name}`; }
