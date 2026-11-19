/* SPDX-License-Identifier: AGPL-3.0-only */
import { assertAdlClock, formatAdlTime, type AdlClock } from './aes31-time.ts';
import { adlInteger } from './aes31-edml.ts';
import { createDeliveryReport, addDeliveryReportItem, sealDeliveryReport, type DeliveryReport } from './delivery-report.ts';
import { createInterchangeVisibility } from './interchange-track-visibility.ts';
import { createSerialLaneAllocator } from './interchange-serial-lane-index.ts';
import { interchangeAnnotationOmission, interchangeCaptionTrackOmission, interchangeClipTimeEffect } from './interchange-omission-inventory.ts';
import { resolveSequenceTimingView } from './sequence-timing-model.ts';
import { portableFileStem } from './portable-file-stem.ts';
import { readMidiClip, readMidiTrack } from './midi-model.ts';
import { roundRational } from './timeline-time.ts';

type Data = Readonly<Record<string, unknown>>;
export interface AdlExportMedia {
	readonly sourceId: string;
	readonly path: string;
	readonly originatorReference: string;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}
export interface AdlExportResult {
	readonly text: string;
	readonly fileName: string;
	readonly media: readonly AdlExportMedia[];
	readonly report: DeliveryReport;
}

/** Audio edit exchange: whole BWF sources, exact cuts, linear fades and static clip gain. */
export function createAdlExport(request: Readonly<{ project: Data; sequenceId?: string }>): AdlExportResult {
	const { project } = request, sampleRate = adlInteger(project.sampleRate, 'sample rate', 1);
	const timing = records(project.sequences).length ? resolveSequenceTimingView(project, request.sequenceId) : null;
	const clock: AdlClock = { sampleRate, rate: timing?.rate ?? { num: 25, den: 1 }, dropFrame: timing?.dropFrame ?? false };
	assertAdlClock(clock);
	const origin = timing ? roundRational(BigInt(timing.startFrameCount) * BigInt(sampleRate) * BigInt(clock.rate.den), BigInt(clock.rate.num), 'point') : 0;
	const draft = createDeliveryReport({ format: 'adl', container: 'AES31-3 EDML with BWF media', sampleRate });
	const report = (code: string, message: string, disposition: 'preserved' | 'omitted' | 'converted' | 'missing' = 'omitted') => {
		addDeliveryReportItem(draft, { code: `adl.${code}`, disposition, message });
	};
	const quote = (value: unknown): string => {
		const text = String(value ?? '');
		const ascii = text.normalize('NFKD').replace(/[^\x20-\x7e]/gu, ' ').replaceAll('"', "'");
		if (ascii !== text) report('text-converted', 'Non-ASCII characters, control characters or quotes were converted for EDML.', 'converted');
		return `"${ascii}"`;
	};
	const title = String(project.title ?? 'Audio timeline');
	const sources = new Map(records(project.sources).map(source => [String(source.id), source]));
	const clips = new Map(records(project.clips).map(clip => [String(clip.id), clip]));
	const tracks = records(project.tracks), visibility = createInterchangeVisibility(tracks, project);
	const media = new Map<string, AdlExportMedia>();
	const indices = new Map<string, number>(), sourceLines: string[] = [], events: string[] = [];
	let destination = 1;
	for (const track of tracks) {
		if (track.type !== 'audio') {
			if (Array.isArray(track.clipIds) && track.clipIds.length) report('track-kind-omitted', 'Picture and non-audio authoring are omitted from ADL.');
			continue;
		}
		if (!visibility.contributes(track)) { report('silent-track-omitted', 'An inaudible track is omitted from the delivered edit.'); continue; }
		const members = (Array.isArray(track.clipIds) ? track.clipIds : []).map(id => {
			const clip = clips.get(String(id)); if (!clip) throw new ReferenceError('ADL track references a missing clip.'); return clip;
		}).sort((a, b) => Number(a.timelineStartFrame) - Number(b.timelineStartFrame));
		const allocate = createSerialLaneAllocator(), laneStarts: number[] = [];
		const channelCount = members.reduce((count, clip) => Math.max(count, Number(sources.get(String(clip.sourceId))?.channelCount ?? 1)), 1);
		if (channelCount > 2) { report('multichannel-track-omitted', 'This ADL export profile supports mono/stereo tracks.'); continue; }
		if (readMidiTrack(track) || members.some(clip => readMidiClip(clip))) report('midi-authoring-converted', 'MIDI authoring is delivered as fallback audio.', 'converted');
		for (const clip of members) {
			if (clip.kind !== 'audio' || clip.mute === true || clip.gain === 0) { report('silent-clip-omitted', 'A muted or non-audio clip is omitted.'); continue; }
			if (interchangeClipTimeEffect(clip)) { report('time-effect-omitted', 'A reversed, repeated or retimed clip is omitted; render it to audio before ADL export.'); continue; }
			const sourceId = String(clip.sourceId), source = sources.get(sourceId);
			if (!source) throw new ReferenceError('ADL clip references a missing source.');
			const sourceRate = adlInteger(source.sampleRate, 'source sample rate', 1), channels = adlInteger(source.channelCount, 'source channels', 1);
			const sourceClock = { ...clock, sampleRate: sourceRate };
			assertAdlClock(sourceClock);
			const sourceFrames = adlInteger(source.frameCount, 'source length', 1);
			const start = adlInteger(clip.timelineStartFrame, 'clip start'), duration = adlInteger(clip.durationFrames, 'clip duration', 1);
			const sourceStart = adlInteger(clip.sourceStartFrame ?? 0, 'source offset');
			if (sourceStart + Math.ceil(duration * sourceRate / sampleRate) > sourceFrames) throw new RangeError('ADL cut exceeds its source.');
			if (!media.has(sourceId)) {
				if (media.size >= 9999) throw new RangeError('ADL package source count exceeds 9999.');
				const index = media.size + 1, path = `audio-${String(index).padStart(4, '0')}.wav`;
				const uid = crypto.randomUUID().replaceAll('-', '');
				media.set(sourceId, { sourceId, path, originatorReference: uid, sampleRate: sourceRate, frameCount: sourceFrames, channelCount: channels });
				indices.set(sourceId, index);
				sourceLines.push(`(Index) ${index}\n(F) ${quote(`URL:file:${path}`)} ${quote(uid)} ${formatAdlTime(0, sourceClock)} ${formatAdlTime(sourceFrames, sourceClock)} ${quote(source.name)} N`);
				report('source-format-converted', 'The source is delivered as 24-bit Broadcast Wave audio.', 'converted');
			}
			const lane = allocate(start, start + duration);
			if (laneStarts[lane] === undefined) { laneStarts[lane] = destination; destination += channelCount; }
			if (destination > 257) throw new RangeError('ADL destination channel count exceeds 256.');
			const first = laneStarts[lane]!, dest = channels === 1 ? String(first) : `${first}~${first + 1}`;
			const lines = [`(Entry) ${events.length + 1}`, `(Cut) I ${indices.get(sourceId)} ${channels === 1 ? '1' : '1~2'} ${dest} ${formatAdlTime(sourceStart, sourceClock)} ${formatAdlTime(origin + start, clock)} ${formatAdlTime(origin + start + duration, clock)} R`, `(Rem) NAME ${quote(clip.title ?? source.name)}`];
			const gain = Number(clip.gain ?? 1);
			if (!Number.isFinite(gain) || gain <= 0 || gain > 16) throw new RangeError('Invalid ADL clip gain.');
			if (gain !== 1) lines.push(`(Gain) _ ${(20 * Math.log10(gain)).toFixed(12)}`);
			for (const [property, shape, key] of [['fadeInFrames', 'fadeInShape', 'Infade'], ['fadeOutFrames', 'fadeOutShape', 'Outfade']] as const) {
				const frames = adlInteger(clip[property] ?? 0, 'fade length');
				if (frames > duration) throw new RangeError('ADL fade exceeds its clip.');
				if (frames && clip[shape] !== undefined && clip[shape] !== 1) report('fade-omitted', 'A nonlinear fade curve is omitted; render it before ADL export.');
				else if (frames) lines.push(`(${key}) ${formatAdlTime(frames, clock)} LIN _ _ _`);
			}
			if (clip.pitchCents || clip.inverted || records(clip.envelope).length || records(clip.effects).length) report('clip-processing-omitted', 'Clip pitch, polarity, envelopes and effects are omitted.');
			events.push(lines.join('\n'));
		}
		if (laneStarts.length > 1) report('overlapping-track-split', 'Overlapping clips use separate destination tracks.', 'converted');
		if (members.length) report('track-names-omitted', 'ADL tracks are identified by destination channel numbers; native track names are omitted.');
		if (track.gain !== undefined && track.gain !== 1 || track.pan || records(track.effects).length || records(track.envelope).length) report('track-processing-omitted', 'Track gain, pan, effects and automation are omitted.');
	}
	if (interchangeAnnotationOmission(project) || interchangeCaptionTrackOmission(project, request.sequenceId)) report('annotations-omitted', 'Markers, regions, labels and captions are omitted.');
	if (records(project.automationLanes).length || records(project.buses).length || records(project.masterEffects).length
		|| project.masterGain !== undefined && project.masterGain !== 1 || hasMixProcessing(project)) report('mix-processing-omitted', 'Mixer routing, automation and master processing are omitted.');
	report('timeline-preserved', 'Audio cuts, source trims, linear fades and static clip gain are represented in ADL.', 'preserved');
	report('conformance-unverified', 'This ADL has not been verified by an independent receiving application.', 'missing');
	const text = `<ADL>\n<VERSION>\n(ADL_ID) ""\n(ADL_UID) ${crypto.randomUUID()}\n(VER_ADL_VERSION) 01.01.00\n(VER_CREATOR) "Soundscaper"\n(VER_CRTR) 01.00.00\n</VERSION>\n<PROJECT>\n(PROJ_TITLE) ${quote(title)}\n</PROJECT>\n<SEQUENCE>\n(SEQ_SAMPLE_RATE) S${sampleRate}\n(SEQ_FRAME_RATE) ${clock.dropFrame ? '29.97' : clock.rate.num}\n(SEQ_DEST_START) ${formatAdlTime(origin, clock)}\n(SEQ_ADL_LEVEL) 1\n(SEQ_CLEAN) FALSE\n</SEQUENCE>\n<SOURCE_INDEX>\n${sourceLines.join('\n')}\n</SOURCE_INDEX>\n<EVENT_LIST>\n${events.join('\n')}\n</EVENT_LIST>\n</ADL>\n`;
	return { text, fileName: `${portableFileStem(title, 'timeline')}.adl`, media: [...media.values()], report: sealDeliveryReport(draft) };
}

function records(value: unknown): readonly Data[] {
	return Array.isArray(value) ? value.filter((entry): entry is Data => entry !== null && typeof entry === 'object' && !Array.isArray(entry)) : [];
}

function hasMixProcessing(project: Data): boolean {
	const record = (value: unknown): Data => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
	const master = record(project.master), mixer = record(project.mixer);
	if (master.gain !== undefined && master.gain !== 1 || master.pan || master.mute || master.solo
		|| records(master.envelope).length || master.effectsActive !== false && records(master.effects).some(effect => effect.enabled !== false)) return true;
	if (records(mixer.groups).length || records(mixer.sends).length || records(mixer.cues).length) return true;
	return records(mixer.edges).some(edge => edge.kind !== 'assignment' || edge.enabled === false
		|| edge.level !== undefined && edge.level !== 1 || edge.position !== undefined && edge.position !== 'post-fader'
		|| !['master', 'output'].includes(String(record(edge.destination).kind)));
}
