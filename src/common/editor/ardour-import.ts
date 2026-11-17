/* SPDX-License-Identifier: AGPL-3.0-only */

import { parseXmlDocument, childElement, childElements, type XmlElement } from './dawproject-xml.ts';
import { addRationals, compareRationals, divideRationals, type Rational } from './timeline-time.ts';
import { ardourMetadata } from './native-daw-import-metadata.ts';
import { ardourMixStrip, ardourRegionEnvelope } from './ardour-import-mix.ts';
import { readArdourMidiTrack } from './ardour-import-midi.ts';
import { ardourRouteHasFlag } from './ardour-route-flags.ts';
import { timelineImportIssue, timelineInterchangeMediaName, TIMELINE_INTERCHANGE_MAXIMUM_BYTES,
	TIMELINE_INTERCHANGE_MAXIMUM_ITEMS, type TimelineInterchangeDocument, type TimelineInterchangeTrack,
	type TimelineInterchangeClip, type TimelineInterchangeMedia, type TimelineInterchangeStrip } from './timeline-interchange-types.ts';

/** Ardour's sample-clock and superclock audio Session snapshots. */
export function parseArdourDocument(text: string): TimelineInterchangeDocument {
	const root = parseXmlDocument(text, { maximumBytes: TIMELINE_INTERCHANGE_MAXIMUM_BYTES, maximumDepth: 64,
		maximumElements: TIMELINE_INTERCHANGE_MAXIMUM_ITEMS, maximumTextBytes: 2 * 1024 * 1024 }, { allowedSimpleDoctype: 'Session' });
	if (root.name !== 'Session') throw new SyntaxError('An Ardour session must start with <Session>.');
	const sampleRate = integer(root.attributes['sample-rate'], 'sample rate', 1);
	const title = root.attributes.name ?? '';
	const time = (value: string | undefined): Rational => ardourTime(value, sampleRate);
	const issues: TimelineInterchangeDocument['issues'][number][] = [];
	const omit = (code: string, message: string) => { issues.push(timelineImportIssue('ardour', code, message)); };
	const sourceNodes = new Map<string, XmlElement>();
	for (const source of childElements(childElement(root, 'Sources') ?? root, 'Source')) {
		const id = required(source, 'id');
		if (sourceNodes.has(id)) throw new SyntaxError('Duplicate Ardour source ID.');
		sourceNodes.set(id, source);
	}
	const playlists = childElements(childElement(root, 'Playlists') ?? root, 'Playlist');
	const playlistIds = new Set<string>();
	for (const playlist of playlists) {
		if (!playlist.attributes.id) continue;
		if (playlistIds.has(playlist.attributes.id)) throw new SyntaxError('Duplicate Ardour playlist ID.');
		playlistIds.add(playlist.attributes.id);
	}
	const media = new Map<string, TimelineInterchangeMedia>();
	const routes = childElements(childElement(root, 'Routes') ?? root, 'Route');
	const tracks: TimelineInterchangeTrack[] = [];
	const buses: NonNullable<TimelineInterchangeDocument['buses']>[number][] = [];
	let master: TimelineInterchangeStrip | undefined;
	const routeIds = new Set<string>();
	const selectedPlaylists = new Set<XmlElement>();
	const sorted = routes.map((route, index) => ({ route, order: Number(childElement(route, 'PresentationInfo')?.attributes.order
		?? /(?:^|:)editor=(\d+)/u.exec(route.attributes['order-keys'] ?? '')?.[1] ?? index) }));
	sorted.sort((a, b) => a.order - b.order);
	for (const { route } of sorted) {
		const io = childElement(route, 'IO');
		const id = route.attributes.id ?? required(io ?? route, 'id');
		if (routeIds.has(id)) throw new SyntaxError('Duplicate Ardour route ID.');
		routeIds.add(id);
		if (ardourRouteHasFlag(route, 'MonitorOut')) { omit('monitor-processing-omitted', 'Monitor processing is not imported.'); continue; }
		const mix = ardourMixStrip(route, root, sampleRate, issues);
		if (ardourRouteHasFlag(route, 'MasterOut')) { master = mix; continue; }
		if (route.attributes['default-type'] === 'midi') {
			tracks.push({ ...readArdourMidiTrack(root, route, playlists, sourceNodes, media, selectedPlaylists, issues), ...mix }); continue;
		}
		const disk = childElement(route, 'Diskstream') ?? childElements(childElement(root, 'DiskStreams') ?? root, 'AudioDiskstream')
			.find(node => node.attributes.id === route.attributes['diskstream-id']);
		if (!disk && route.attributes['diskstream-id']) throw new ReferenceError('Ardour diskstream is unavailable.');
		const playlistId = route.attributes['audio-playlist'] ?? disk?.attributes.playlist;
		const candidates = playlistId ? playlists.filter(node => node.attributes.id === playlistId || node.attributes.name === playlistId)
			: playlists.filter(node => node.attributes['orig-track-id'] === id || node.attributes.name === route.attributes.name);
		if (candidates.length > 1) throw new SyntaxError('Ardour active playlist is ambiguous.');
		if (!candidates.length && route.attributes['audio-playlist']) throw new ReferenceError('Ardour active playlist is unavailable.');
		if (!candidates.length && !disk) {
			buses.push({ id, name: route.attributes.name ?? '', ...mix }); continue;
		}
		// Ardour 2 does not serialize empty playlists; the diskstream retains their name.
		const playlist: XmlElement = candidates[0] ?? { name: 'Playlist', attributes: { name: playlistId ?? '' }, children: [], text: '' };
		selectedPlaylists.add(playlist);
		if (playlist.attributes.type === 'midi') { omit('midi-omitted', 'MIDI playlists are not imported.'); continue; }
		const clips: TimelineInterchangeClip[] = [];
		const splitTracks = new Map<number, TimelineInterchangeClip[]>();
		for (const region of childElements(playlist, 'Region')) {
			if (region.attributes.type === 'midi') { omit('midi-omitted', 'MIDI regions are not imported.'); continue; }
			if (numeric(region.attributes.stretch, 1) !== 1 || numeric(region.attributes.shift, 1) !== 1) {
				omit('stretch-region-omitted', 'A stretched or pitch shifted region cannot be represented by an unprocessed audio cut.'); continue;
			}
			const refs = Object.entries(region.attributes).filter(([key]) => /^source-\d+$/u.test(key))
				.sort(([a], [b]) => Number(a.slice(7)) - Number(b.slice(7))).map(([, value]) => value);
			if (!refs.length) throw new ReferenceError('Ardour audio region has no source.');
			const paths = refs.map(ref => {
				const source = sourceNodes.get(ref);
				if (!source || source.attributes.type === 'midi') throw new ReferenceError('Ardour region references an unavailable audio source.');
				return required(source, 'name');
			});
			const distinctPaths = new Set(paths);
			if (refs.length > 2 || (region.attributes.channels && integer(region.attributes.channels, 'channel count', 1) !== refs.length)
				|| refs.some((ref, index) => integer(sourceNodes.get(ref)!.attributes.channel ?? '0', 'source channel') !== (distinctPaths.size === 1 ? index : 0))) {
				throw new RangeError('Ardour audio import requires an unremapped mono or stereo channel layout.');
			}
			const start = time(required(region, 'position')), duration = time(required(region, 'length'));
			if (duration.num <= 0) throw new RangeError('Ardour region length must be positive.');
			for (const [index, path] of [...distinctPaths].entries()) {
				const channelIndices = refs.flatMap((ref, channel) => paths[channel] === path ? [integer(sourceNodes.get(ref)!.attributes.channel ?? '0', 'source channel')] : []);
				const mediaId = `ardour-audio:${JSON.stringify([path, channelIndices])}`;
				if (!media.has(mediaId)) media.set(mediaId, { id: mediaId, path: mediaPath(path, title), channelIndices,
					name: timelineInterchangeMediaName(path), kind: 'audio', aliases: [path, `sounds/${path}`] });
				const clip: TimelineInterchangeClip = { id: region.attributes.id ?? `region-${clips.length}`, name: region.attributes.name ?? '',
					mediaId, start, duration, sourceStart: time(required(region, 'start')),
					gain: numeric(region.attributes['scale-amplitude'] ?? region.attributes['scale-gain'], 1),
					muted: flag(region.attributes.muted) || (region.attributes.flags ?? '').split(',').includes('Muted'),
					envelope: ardourRegionEnvelope(region, root, Math.round(duration.num / duration.den * sampleRate), sampleRate, issues),
					fadeIn: fadeLength(region, 'FadeIn', time), fadeOut: fadeLength(region, 'FadeOut', time) };
				if (distinctPaths.size === 1) clips.push(clip);
				else { if (!splitTracks.has(index)) splitTracks.set(index, []); splitTracks.get(index)!.push(clip); }
			}
			if (distinctPaths.size > 1) issues.push(timelineImportIssue('ardour', 'split-stereo-converted', 'Split stereo sources become parallel left and right audio tracks.', 'converted'));
			if (childElement(region, 'FadeIn') || childElement(region, 'FadeOut')) issues.push(timelineImportIssue('ardour', 'fade-curve-converted', 'Explicit fade lengths use the editor default curve; implicit Ardour fades are omitted.', 'converted'));
		}
		if ([clips, ...splitTracks.values()].some(hasOverlaps)) omit('layering-omitted', 'Region layer priorities and crossfades are omitted; overlapping cuts play additively.');
		const { gain = 1, pan = 0 } = mix;
		const oldPanners = io ? childElements(childElement(io, 'Panner') ?? io, 'StreamPanner') : [];
		if (oldPanners.length > 1) omit('channel-pan-omitted', 'Independent legacy channel panners are replaced by centered stereo balance.');
		if (pan < -1 || pan > 1 || gain < 0) throw new RangeError('Ardour track gain or pan is invalid.');
		const name = route.attributes.name ?? io?.attributes.name ?? playlist.attributes.name ?? '';
		if (splitTracks.size) buses.push({ id, name, channelCount: 2, ...mix });
		const leafMix = splitTracks.size ? { gain: 1, pan: 0, mute: false, solo: false, output: id } : mix;
		if (clips.length || !splitTracks.size) tracks.push({ id: splitTracks.size ? `${id}:mono` : id, name, kind: 'audio', clips, ...leafMix });
		for (const [index, clips] of splitTracks) tracks.push({ id: `${id}:${index}`, name: `${name} (${index === 0 ? 'L' : 'R'})`,
			kind: 'audio', clips, ...leafMix, pan: index === 0 ? -1 : 1 });

	}
	if (playlists.length > selectedPlaylists.size) omit('alternate-playlists-omitted', 'Only active audio and MIDI playlists are imported.');
	for (const name of ['RouteGroups']) if (childElement(root, name)?.children.length) omit(`${name.toLowerCase()}-omitted`, `Ardour ${name} authoring is not imported.`);
	issues.push(timelineImportIssue('ardour', 'sequence-clock-converted', 'Audio sample placement is retained; the sequence clock uses 30 fps with a zero timecode origin.', 'converted'));
	return { format: 'ardour', title, sampleRate, rate: { num: 30, den: 1 }, dropFrame: false, startFrameCount: 0,
		tracks, buses, master, ...ardourMetadata(root, sampleRate, issues), media: [...media.values()], issues };
}

function ardourTime(value: string | undefined, sampleRate: number): Rational {
	if (value?.startsWith('b')) throw new RangeError('Ardour beat-domain regions require tempo-map conversion; use audio-time regions.');
	const match = /^(a)?(\d+)(?:@a\d+)?$/u.exec(value ?? '');
	if (!match) throw new SyntaxError('Invalid Ardour audio time.');
	return divideRationals(integer(match[2], 'audio time'), match[1] ? 282240000 : sampleRate);
}
function integer(value: string | undefined, label: string, minimum = 0): number {
	if (!value || !/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum) throw new RangeError(`Ardour ${label} must be a safe integer.`);
	return Number(value);
}
function numeric(value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	if (!value.trim() || !Number.isFinite(Number(value))) throw new RangeError('Ardour control must be finite.');
	return Number(value);
}
function required(node: XmlElement, name: string): string {
	const value = node.attributes[name];
	if (!value) throw new SyntaxError(`Ardour ${node.name} requires ${name}.`);
	return value;
}
function flag(value: string | undefined): boolean { return value === '1' || value === 'yes' || value === 'true'; }
function mediaPath(path: string, title: string): string {
	return /[\\/]/u.test(path) ? path : `interchange/${title}/audiofiles/${path}`;
}
function fadeLength(region: XmlElement, name: string, time: (value: string) => Rational): Rational {
	if (['0', 'no', 'false'].includes(region.attributes[name === 'FadeIn' ? 'fade-in-active' : 'fade-out-active'] ?? '')) return { num: 0, den: 1 };
	const fade = childElement(region, name), events = fade && childElement(childElement(fade, 'AutomationList') ?? fade, 'events');
	if (['0', 'no', 'false'].includes(fade?.attributes.active ?? '')) return { num: 0, den: 1 };
	if (!events?.text.trim()) return { num: 0, den: 1 };
	const lines = events.text.trim().split(/\r?\n/u);
	return time(lines.at(-1)!.trim().split(/\s+/u)[0]!);
}

function hasOverlaps(clips: readonly TimelineInterchangeClip[]): boolean {
	let end: Rational = { num: 0, den: 1 };
	for (const clip of [...clips].sort((a, b) => compareRationals(a.start, b.start))) {
		if (compareRationals(clip.start, end) < 0) return true;
		end = addRationals(clip.start, clip.duration);
	}
	return false;
}
