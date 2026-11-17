/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseReaperChunks, reaperChildren, reaperValues } from './reaper-chunks.ts';
import { reaperNumber, reaperTime, reaperReport, reportReaperProcessing } from './reaper-import-values.ts';
import { reaperItem } from './reaper-import-item.ts';
import { normalizeProjectSampleRate } from './project-sample-rate.ts';
import { addRationals, compareRationals, secondsToSampleFrame } from './timeline-time.ts';
import { rationalFromDouble } from './dawproject-format.ts';
import type { TimelineInterchangeDocument, TimelineInterchangeMedia, TimelineInterchangeTrack } from './timeline-interchange-types.ts';

/** Import the audio edit of a native RPP; foreign processing never executes. */
export function parseReaperDocument(text: string): TimelineInterchangeDocument {
	const root = parseReaperChunks(text);
	const values = (name: string) => reaperValues(root.entries, name);
	const issues: TimelineInterchangeDocument['issues'][number][] = [];
	const report = reaperReport(issues);
	const storedRate = reaperNumber(values('SAMPLERATE')?.[0]);
	const sampleRate = normalizeProjectSampleRate(storedRate || 48000);
	if (!storedRate || reaperNumber(values('SAMPLERATE')?.[1]) !== 1) report('sample-rate-converted',
		'The REAPER hardware sample rate is unavailable; the stored rate, or 48000 Hz when unspecified, defines the imported sample grid.', 'converted');
	if (reaperNumber(values('PLAYRATE')?.[0], 1) !== 1) throw new RangeError('REAPER project playback rates other than one are not supported.');
	const bpm = reaperNumber(values('TEMPO')?.[0], 120);
	const numerator = reaperNumber(values('TEMPO')?.[1], 4), denominator = reaperNumber(values('TEMPO')?.[2], 4);
	if (bpm < 1 || bpm > 1000 || !Number.isSafeInteger(numerator) || numerator < 1 || numerator > 32
		|| ![1, 2, 4, 8, 16, 32].includes(denominator)) throw new RangeError('Unsupported REAPER tempo or time signature.');
	const media = new Map<string, TimelineInterchangeMedia>();
	const tracks: TimelineInterchangeTrack[] = [];
	for (const [index, track] of reaperChildren(root.entries, 'TRACK').entries()) {
		const control = (name: string) => reaperValues(track.entries, name);
		reportReaperProcessing(track.entries, report);
		if (track.entries.some(entry => ['AUXRECV', 'HWOUT'].includes(entry.name))
			|| reaperNumber(control('ISBUS')?.[0]) !== 0 || reaperNumber(control('MAINSEND')?.[0], 1) !== 1) {
			report('routing-omitted', 'REAPER folders, sends and hardware routing are omitted; imported tracks use direct master assignments.');
		}
		if (reaperNumber(control('IPHASE')?.[0]) !== 0) report('polarity-omitted', 'REAPER phase inversion is omitted; review polarity before mixing.');
		if (reaperNumber(control('PLAYOFFS')?.[0]) !== 0) report('track-offset-omitted', 'REAPER track playback offsets are omitted; stored item positions are retained.');
		if (reaperNumber(control('FREEMODE')?.[0]) !== 0) {
			report('lanes-omitted', 'REAPER fixed lanes and free item positioning are not imported; affected tracks retain no clips.');
		}
		const clips = reaperNumber(control('FREEMODE')?.[0]) !== 0 ? [] : reaperChildren(track.entries, 'ITEM')
			.map((item, itemIndex) => reaperItem(item, `${index}:${itemIndex}`, media, report)).filter(item => item !== null);
		const ordered = [...clips].sort((a, b) => compareRationals(a.start, b.start));
		if (ordered.some((clip, index) => index > 0 && compareRationals(clip.start, addRationals(ordered[index - 1]!.start, ordered[index - 1]!.duration)) < 0)) {
			report('overlap-converted', 'REAPER overlapping item mix modes are omitted; overlapping cuts play additively.', 'converted');
		}
		tracks.push({ id: `track-${index}`, name: control('NAME')?.[0] ?? '', kind: 'audio', clips,
			gain: reaperNumber(control('VOLPAN')?.[0], 1), pan: reaperNumber(control('VOLPAN')?.[1]),
			mute: reaperNumber(control('MUTESOLO')?.[0]) !== 0, solo: reaperNumber(control('MUTESOLO')?.[1]) !== 0 });
	}
	reportReaperProcessing(root.entries, report);
	const markers = root.entries.filter(entry => entry.kind === 'line' && entry.name === 'MARKER').flatMap(entry => {
		if ((reaperNumber(entry.values[3]) & 1) !== 0) {
			report('regions-omitted', 'REAPER regions are not imported; ordinary project markers are retained.'); return [];
		}
		return [{ frame: secondsToSampleFrame(reaperTime(entry.values[1], true), sampleRate), name: entry.values[2] ?? '' }];
	});
	if (values('PROJOFFS') || values('TIMEMODE')) report('timecode-converted', 'REAPER display offsets and ruler settings are omitted.', 'converted');
	report('sequence-clock-converted', 'Audio edits use the project sample grid; the sequence display uses 30 fps and a zero timecode origin.', 'converted');
	report('pan-law-converted', 'Track and master pan use the editor pan law; REAPER stereo pan modes and pan laws may sound different.', 'converted');
	return { format: 'reaper', title: '', sampleRate, rate: { num: 30, den: 1 }, dropFrame: false, startFrameCount: 0,
		tracks, media: [...media.values()], issues, markers,
		tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: rationalFromDouble(bpm) }] },
		signatureMap: { events: [{ id: 'reaper-signature', bar: 0, numerator, denominator }] },
		master: { gain: reaperNumber(values('MASTER_VOLUME')?.[0], 1), pan: reaperNumber(values('MASTER_VOLUME')?.[1]),
			mute: (reaperNumber(values('MASTERMUTESOLO')?.[0]) & 1) !== 0 } };
}
