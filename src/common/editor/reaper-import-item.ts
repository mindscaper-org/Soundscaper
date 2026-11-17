/* SPDX-License-Identifier: AGPL-3.0-only */

import { reaperChildren, reaperValues, type ReaperChunk, type ReaperEntry } from './reaper-chunks.ts';
import { reaperNumber, reaperTime, reportReaperProcessing, type ReaperReport } from './reaper-import-values.ts';
import type { TimelineInterchangeClip, TimelineInterchangeMedia } from './timeline-interchange-types.ts';

export function reaperItem(item: ReaperChunk, id: string, media: Map<string, TimelineInterchangeMedia>, report: ReaperReport): TimelineInterchangeClip | null {
	const takes: ReaperEntry[][] = [[]];
	let selected = 0, explicitSelection = false;
	for (const entry of item.entries) {
		if (entry.kind === 'line' && entry.name === 'TAKE') {
			takes.push([]);
			if (entry.values.includes('SEL')) {
				if (explicitSelection) throw new SyntaxError('Ambiguous REAPER active take.');
				selected = takes.length - 1; explicitSelection = true;
			}
		} else takes.at(-1)!.push(entry);
	}
	const shared = takes[0]!, take = takes[selected]!;
	const values = (name: string) => reaperValues(take, name);
	const common = (name: string) => reaperValues(shared, name);
	if (takes.length > 1) report('alternate-takes-omitted', 'Only the active REAPER take is imported; alternate takes and comp authoring are omitted.');
	if (reaperNumber(common('ALLTAKES')?.[0]) !== 0) {
		report('all-takes-omitted', 'Items that play all takes at once are not imported.'); return null;
	}
	reportReaperProcessing(take, report);
	if (reaperNumber(values('PLAYRATE')?.[0], 1) !== 1 || reaperNumber(values('PLAYRATE')?.[2]) !== 0
		|| take.some(entry => /^(?:SM|STRETCHMARKER|STRETCHMARKERS)$/u.test(entry.name))
		|| reaperNumber(values('CHANMODE')?.[0]) !== 0) {
		report('transformed-item-omitted', 'Stretched, pitch shifted or channel-remapped REAPER takes are not imported.'); return null;
	}
	const sources = reaperChildren(take, 'SOURCE');
	if (sources.length > 1) throw new SyntaxError('A REAPER take must contain one source.');
	const source = sources[0];
	if (!source || !['WAVE', 'FLAC', 'MP3', 'VORBIS', 'OPUS', 'AIFF', 'WAVPACK', '_OFFLINE_WAVE'].includes(source.values[0] ?? '')) {
		report('source-omitted', 'REAPER MIDI, video, generated, reversed and section sources are not imported.'); return null;
	}
	const path = reaperValues(source.entries, 'FILE')?.[0];
	if (!path || path.length > 4096 || Array.from(path).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
		throw new SyntaxError('REAPER media requires a bounded file path.');
	}
	if (!media.has(path)) media.set(path, { id: path, path, name: path.split(/[\\/]/u).at(-1)!, kind: 'audio' });
	const start = reaperTime(common('POSITION')?.[0], true), duration = reaperTime(common('LENGTH')?.[0], true);
	if (duration.num <= 0) throw new RangeError('REAPER item length must be positive.');
	const trim = reaperNumber(common('VOLPAN')?.[0], 1);
	const takeControl = selected === 0 ? values('VOLPAN') : values('TAKEVOLPAN');
	const takeGain = reaperNumber(takeControl?.[selected === 0 ? 2 : 1], 1);
	if (trim < 0) throw new RangeError('REAPER item gain must be nonnegative.');
	if (takeGain < 0) report('polarity-omitted', 'REAPER phase inversion is omitted; review polarity before mixing.');
	if (reaperNumber(takeControl?.[selected === 0 ? 1 : 0]) !== 0) report('take-pan-omitted', 'REAPER take pan is omitted; track pan is retained.');
	if (reaperNumber(common('LOOP')?.[0]) !== 0) report('looping-omitted', 'REAPER source looping is omitted; edits beyond available source media are shortened to one source pass.');
	const fadeIn = reaperTime(common('FADEIN')?.[1]), fadeOut = reaperTime(common('FADEOUT')?.[1]);
	if (fadeIn.num || fadeOut.num) report('fade-curve-converted', 'REAPER fade lengths use the editor fade curve; REAPER curvature and automatic crossfades are not retained.', 'converted');
	if (reaperNumber(common('FADEIN_AUTO')?.[1], -1) >= 0 || reaperNumber(common('FADEOUT_AUTO')?.[1], -1) >= 0) {
		report('auto-fades-omitted', 'REAPER automatic crossfades are omitted; explicit fade lengths are retained.');
	}
	if (reaperNumber(common('MUTE')?.[1]) !== 0) report('item-solo-omitted', 'REAPER item solo overrides are omitted; stored item mute is retained.');
	return { id, name: values('NAME')?.[0] ?? '', mediaId: path, start, duration, sourceStart: reaperTime(values('SOFFS')?.[0]),
		gain: trim * Math.abs(takeGain), muted: reaperNumber(common('MUTE')?.[0]) !== 0, fadeIn, fadeOut };
}
