/* SPDX-License-Identifier: AGPL-3.0-only */

import { childElement, childElements, walkXml, type XmlElement } from './dawproject-xml.ts';
import { createInterchangeMidiClock, type InterchangeMidiTempo } from './interchange-midi-clock.ts';
import { subtractRationals, divideRationals, compareRationals, type Rational } from './timeline-time.ts';
import { timelineImportIssue, timelineInterchangeMediaName, type TimelineInterchangeDocument,
	type TimelineInterchangeTrack, type TimelineInterchangeMedia, type TimelineInterchangeClip } from './timeline-interchange-types.ts';

export function readArdourMidiTrack(root: XmlElement, route: XmlElement, playlists: readonly XmlElement[],
	sources: ReadonlyMap<string, XmlElement>, media: Map<string, TimelineInterchangeMedia>,
	selected: Set<XmlElement>, issues: TimelineInterchangeDocument['issues'][number][]): TimelineInterchangeTrack {
	const id = required(route, 'id'), name = route.attributes.name ?? '';
	const playlistId = route.attributes['midi-playlist'];
	const candidates = playlists.filter(node => playlistId ? node.attributes.id === playlistId : node.attributes['orig-track-id'] === id);
	if (candidates.length > 1) throw new SyntaxError('Ardour active MIDI playlist is ambiguous.');
	if (!candidates.length && playlistId) throw new ReferenceError('Ardour active MIDI playlist is unavailable.');
	const playlist = candidates[0];
	if (playlist) selected.add(playlist);
	const clips: TimelineInterchangeClip[] = [];
	const control = (owner: XmlElement, key: string, fallback: number): number => {
		const value = childElements(owner, 'Controllable').find(node => node.attributes.name === key)?.attributes.value;
		return value === undefined ? fallback : finite(value);
	};
	const flag = (value: string | undefined) => ['1', 'yes', 'true'].includes(value ?? '');
	const gain = childElements(route, 'Processor').filter(node => ['amp', 'trim'].includes(node.attributes.type ?? ''))
		.reduce((value, node) => value * control(node, 'gaincontrol', 1), 1);
	const track: TimelineInterchangeTrack = { id, name, kind: 'audio', midi: true, clips, gain,
		pan: control(childElement(route, 'Pannable') ?? route, 'pan-azimuth', 0.5) * 2 - 1,
		mute: control(route, 'mute', 0) !== 0 || flag(route.attributes.muted) || route.attributes.active === 'no'
			|| flag(childElement(route, 'MuteMaster')?.attributes.muted),
		solo: control(route, 'solo', 0) !== 0 || flag(route.attributes['self-solo'] ?? route.attributes.soloed) };
	if (gain < 0 || Math.abs(track.pan ?? 0) > 1) throw new RangeError('Invalid Ardour MIDI mixer controls.');
	if (!playlist || !childElements(playlist, 'Region').length) return track;
	let tempos: readonly InterchangeMidiTempo[];
	try { tempos = ardourMidiTempos(root); }
	catch (error) {
		issues.push(timelineImportIssue('ardour', 'midi-timing-omitted', 'MIDI regions require a supported stepped tempo map; tempo ramps, music-time anchors and legacy MIDI timing are not imported.', 'omitted', { reason: String(error) }));
		return track;
	}
	const clock = createInterchangeMidiClock(tempos);
	const time = (value: string): Rational => {
		const match = /^([ab])(\d+)$/u.exec(value);
		if (!match) throw new RangeError('Unsupported Ardour MIDI time.');
		const count = finite(match[2]!);
		if (!Number.isSafeInteger(count)) throw new RangeError('Unsafe Ardour MIDI time.');
		return match[1] === 'b' ? clock.atBeat(count / 1920) : divideRationals(count, 282240000);
	};
	for (const region of childElements(playlist, 'Region')) {
		const source = sources.get(required(region, 'source-0'));
		if (!source || source.attributes.type !== 'midi') throw new ReferenceError('Ardour MIDI region references an unavailable MIDI source.');
		const path = required(source, 'name'), mediaId = `midi:${required(source, 'id')}`;
		const start = time(required(region, 'position'));
		const length = /^([ab]\d+)@([ab]\d+)$/u.exec(required(region, 'length'));
		if (!length) throw new RangeError('Unsupported Ardour MIDI length.');
		const duration = length[1]!.startsWith('b')
			? subtractRationals(clock.atBeat(clock.beatAt(start) + finite(length[1]!.slice(1)) / 1920), start) : time(length[1]!);
		const sourceStart = required(region, 'start');
		if (!/^[ab]\d+$/u.test(sourceStart)) throw new RangeError('Unsupported Ardour MIDI source start.');
		const sourceBeat = sourceStart.startsWith('b') ? clock.beatAt(start) - finite(sourceStart.slice(1)) / 1920
			: clock.beatAt(subtractRationals(start, time(sourceStart)));
		const trim = subtractRationals(start, clock.atBeat(sourceBeat));
		if (duration.num <= 0 || trim.num < 0 || compareRationals(time(length[2]!), start) !== 0) throw new RangeError('Invalid Ardour MIDI region range or anchor.');
		if (!media.has(mediaId)) media.set(mediaId, { id: mediaId, name: timelineInterchangeMediaName(path), kind: 'audio', midi: true,
			path: /[\\/]/u.test(path) ? path : `interchange/${root.attributes.name ?? ''}/midifiles/${path}`, aliases: [path, `midifiles/${path}`] });
		clips.push({ id: region.attributes.id ?? `midi-${clips.length}`, name: region.attributes.name ?? '', mediaId, start, duration, sourceStart: trim,
			muted: flag(region.attributes.muted), midiFileTiming: { sourceBeat, tempos } });
	}
	if ([...walkXml(route)].some(node => node.name === 'Processor' || node.name === 'AutomationList')) {
		issues.push(timelineImportIssue('ardour', 'midi-processing-omitted', 'MIDI instruments, channel filtering, automation and processing are replaced by the default synthesizer.'));
	}
	return track;
}

function ardourMidiTempos(root: XmlElement): readonly InterchangeMidiTempo[] {
	const map = childElement(root, 'TempoMap');
	if (!map || childElement(map, 'MusicTimes')?.children.length || map.attributes['superclocks-per-second'] !== '282240000') throw new RangeError('Unsupported Ardour tempo map.');
	const nodes = childElements(childElement(map, 'Tempos') ?? map, 'Tempo');
	const tempos = nodes.map(node => {
		const npm = finite(required(node, 'npm')), end = finite(node.attributes.enpm ?? String(npm));
		if (npm !== end || finite(node.attributes.omega ?? '0') !== 0) throw new RangeError('Ardour tempo ramps are not supported.');
		const quarters = /^(\d+):(\d+)$/u.exec(required(node, 'quarters'));
		if (!quarters || Number(quarters[2]) >= 1920) throw new RangeError('Invalid Ardour tempo quarters.');
		return { beat: finite(quarters[1]!) + finite(quarters[2]!) / 1920, bpm: npm * 4 / finite(required(node, 'note-type')) };
	});
	const clock = createInterchangeMidiClock(tempos);
	for (const [index, node] of nodes.entries()) {
		const observed = finite(required(node, 'sclock')), expected = clock.atBeat(tempos[index]!.beat);
		if (!Number.isSafeInteger(observed) || Math.abs(observed - expected.num / expected.den * 282240000) > 1) throw new RangeError('Inconsistent Ardour tempo anchors.');
	}
	return tempos;
}
function required(node: XmlElement, key: string): string {
	const value = node.attributes[key];
	if (!value) throw new SyntaxError(`Ardour MIDI ${node.name} requires ${key}.`);
	return value;
}
function finite(value: string): number {
	if (!value.trim() || !Number.isFinite(Number(value))) throw new RangeError('Invalid Ardour MIDI number.');
	return Number(value);
}
