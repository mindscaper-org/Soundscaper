/* SPDX-License-Identifier: AGPL-3.0-only */

import { divideRationals, multiplyRationals, roundRational, type Rational } from './timeline-time.ts';
import { dawRecord, dawArray, dawInteger, dawNumber, dawText, dawBoolean, boundDawJson } from './native-daw-import-values.ts';
import { readSoundcraftMidi } from './soundcraft-import-midi.ts';
import { timelineImportIssue, timelineInterchangeMediaName, type TimelineInterchangeDocument, type TimelineInterchangeMedia,
	type TimelineInterchangeTrack, type TimelineInterchangeClip } from './timeline-interchange-types.ts';

/** SoundCraft's craft-scraft-format v1 JSON; no plug-in code or state is executed. */
export function parseSoundcraftDocument(text: string): TimelineInterchangeDocument {
	const root = dawRecord(JSON.parse(text.replace(/^\uFEFF/u, '')));
	boundDawJson(root);
	if (root.format_version !== 1 && root.format_version !== 0) throw new RangeError('Unsupported SoundCraft format_version.');
	const sampleRate = dawInteger(root.sample_rate, 'SoundCraft sample rate', 1);
	const seconds = (value: unknown): Rational => divideRationals(dawInteger(value, 'SoundCraft sample position'), sampleRate);
	const issues: TimelineInterchangeDocument['issues'][number][] = [];
	const omit = (code: string, message: string) => { issues.push(timelineImportIssue('soundcraft', code, message)); };
	const sources = new Map<string, TimelineInterchangeMedia>();
	for (const value of dawArray(root.sources)) {
		const source = dawRecord(value), id = sourceId(source.id);
		if (sources.has(id)) throw new SyntaxError('Duplicate SoundCraft source ID.');
		const path = dawText(source.path);
		const sourceRate = dawInteger(source.sample_rate, 'SoundCraft source sample rate', 1);
		sources.set(id, { id, path, name: timelineInterchangeMediaName(path, dawText(source.name)), kind: 'audio',
			duration: divideRationals(dawInteger(source.frames, 'SoundCraft source frames', 1), sourceRate) });
	}
	const used = new Set<string>(), trackIds = new Set<string>();
	const tracks: TimelineInterchangeTrack[] = [];
	for (const value of dawArray(root.tracks)) {
		const track = dawRecord(value), id = sourceId(track.id);
		if (trackIds.has(id)) throw new SyntaxError('Duplicate SoundCraft track ID.');
		trackIds.add(id);
		const midi = track.kind === 'Midi' || track.kind === 'Instrument';
		if (track.kind !== 'Audio' && !midi) { omit('track-omitted', `The ${dawText(track.kind)} track is outside the audio and MIDI import profile.`); continue; }
		const playlists = dawArray(track.playlists);
		const active = dawInteger(track.active_playlist, 'SoundCraft active playlist');
		if (!playlists[active]) throw new RangeError('SoundCraft active playlist is unavailable.');
		if (playlists.length > 1) omit('alternate-playlists-omitted', 'Only the active playlist of each track is imported.');
		const clips: TimelineInterchangeClip[] = [];
		const clipIds = new Set<string>();
		for (const value of dawArray(dawRecord(playlists[active]).clips)) {
			const clip = dawRecord(value), clipId = sourceId(clip.id), content = dawRecord(clip.content);
			if (clipIds.has(clipId)) throw new SyntaxError('Duplicate SoundCraft clip ID.');
			clipIds.add(clipId);
			const fade = (value: unknown): Rational => {
				if (value === undefined) return seconds(0);
				const entry = dawRecord(value), length = seconds(entry.len);
				if (length.num && (entry.shape !== 'Linear' || dawNumber(entry.curvature, 0) !== 0)) {
					issues.push(timelineImportIssue('soundcraft', 'fade-curve-converted', 'Fade length is retained with the editor default curve.', 'converted'));
				}
				return length;
			};
			if (clip.gain_env && dawArray(clip.gain_env).length) omit('clip-envelope-omitted', 'Clip gain automation is omitted; static clip gain is retained.');
			if (midi && content.Midi) {
				const mediaId = `midi:${id}:${clipId}`, start = seconds(clip.start);
				if (dawNumber(clip.stretch, 1) !== 1) { omit('stretch-clip-omitted', 'A stretched MIDI clip is not imported.'); continue; }
				sources.set(mediaId, { id: mediaId, path: '', name: dawText(clip.name), kind: 'audio', midi: true });
				clips.push({ id: clipId, name: dawText(clip.name), mediaId, start, duration: seconds(dawInteger(clip.length, 'SoundCraft clip length', 1)),
					sourceStart: seconds(0), gain: dbGain(dawNumber(clip.gain_db, 0)), muted: dawBoolean(clip.muted),
					fadeIn: fade(clip.fade_in), fadeOut: fade(clip.fade_out),
					midi: readSoundcraftMidi(dawRecord(content.Midi).sequence, root.tempo, start, sampleRate) });
				used.add(mediaId); continue;
			}
			if (!content.Audio || midi) { omit('clip-omitted', 'A clip outside its track import profile was omitted.'); continue; }
			if (dawNumber(clip.stretch, 1) !== 1) { omit('stretch-clip-omitted', 'A stretched clip cannot be represented by an unprocessed audio cut.'); continue; }
			const audio = dawRecord(content.Audio), mediaId = sourceId(audio.source);
			if (!sources.has(mediaId)) throw new ReferenceError('SoundCraft clip references an undeclared source.');
			const duration = seconds(dawInteger(clip.length, 'SoundCraft clip length', 1));

			clips.push({ id: clipId, name: dawText(clip.name), mediaId, start: seconds(clip.start), duration,
				sourceStart: seconds(audio.offset), gain: dbGain(dawNumber(clip.gain_db, 0)), muted: dawBoolean(clip.muted),
				fadeIn: fade(clip.fade_in), fadeOut: fade(clip.fade_out) });
			used.add(mediaId);
		}
		const mixer = dawRecord(track.mixer), pans = dawArray(mixer.pan);
		let pan = 0;
		if (pans.length === 1) pan = dawNumber(pans[0], 0);
		else if (!(pans.length === 2 && pans[0] === -1 && pans[1] === 1)) omit('pan-omitted', 'Independent channel panners are replaced by centered stereo balance.');
		if (pan < -1 || pan > 1) throw new RangeError('SoundCraft pan is outside -1..1.');
		if (dawArray(mixer.inserts ?? []).some(Boolean) || track.instrument) omit('plugins-omitted', 'Track plug-ins and instruments are not imported.');
		if (dawArray(track.automation ?? []).length) omit('automation-omitted', 'Track automation is not imported.');
		if (dawArray(mixer.sends ?? []).some(Boolean) || mixer.output !== 'Main' || track.folder != null) omit('routing-omitted', 'Sends, folder routing and output routing are replaced by direct master output.');
		if (dawBoolean(mixer.phase_invert)) omit('polarity-omitted', 'Track polarity inversion is not imported.');
		tracks.push({ id, name: dawText(track.name), kind: 'audio', clips, ...(midi ? { midi: true as const } : {}),
			gain: dbGain(dawNumber(mixer.volume_db, 0) + dawNumber(mixer.trim_db, 0)), pan,
			mute: dawBoolean(mixer.mute) || dawBoolean(track.inactive), solo: dawBoolean(mixer.solo) });
	}
	for (const key of ['tempo', 'markers', 'groups', 'videos', 'busses']) {
		const value = root[key];
		if (value && (!Array.isArray(value) || value.length)) omit(`${key}-omitted`, `SoundCraft ${key} authoring is not imported.`);
	}
	const { rate, dropFrame } = soundcraftRate(root.frame_rate);
	const origin = multiplyRationals(seconds(root.timecode_start ?? 0), rate);
	const startFrameCount = roundRational(origin.num, origin.den, 'point');
	return { format: 'soundcraft', title: dawText(root.name), sampleRate, rate, dropFrame, startFrameCount, tracks,
		media: [...sources.values()].filter(source => used.has(source.id)), issues };
}

function sourceId(value: unknown): string { return String(dawInteger(value, 'SoundCraft ID')); }
function dbGain(value: number): number {
	const gain = 10 ** (value / 20);
	if (!Number.isFinite(gain)) throw new RangeError('SoundCraft gain is outside the finite range.');
	return gain;
}

function soundcraftRate(value: unknown): { rate: Rational; dropFrame: boolean } {
	const rates: Record<string, Rational> = {
		Fps24: { num: 24, den: 1 }, Fps25: { num: 25, den: 1 }, Fps30: { num: 30, den: 1 },
		Fps23_976: { num: 24000, den: 1001 }, Fps29_97: { num: 30000, den: 1001 }, Fps29_97Drop: { num: 30000, den: 1001 },
		Fps50: { num: 50, den: 1 }, Fps60: { num: 60, den: 1 }, Fps59_94: { num: 60000, den: 1001 }, Fps59_94Drop: { num: 60000, den: 1001 },
		Fps47_952: { num: 48000, den: 1001 }, Fps48: { num: 48, den: 1 }, Fps100: { num: 100, den: 1 },
		Fps119_88: { num: 120000, den: 1001 }, Fps120: { num: 120, den: 1 },
	};
	const key = dawText(value, 'Fps30'), rate = Object.hasOwn(rates, key) ? rates[key]! : null;
	if (!rate) throw new RangeError('Unsupported SoundCraft frame rate.');
	return { rate, dropFrame: key.endsWith('Drop') };
}
