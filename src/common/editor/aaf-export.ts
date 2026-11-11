/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport, type DeliveryReport } from './delivery-report.ts';
import { createInterchangeVisibility } from './interchange-track-visibility.ts';
import { interchangeAnnotationOmission, interchangeCaptionTrackOmission, interchangeClipTimeEffect } from './interchange-omission-inventory.ts';
import { createSerialLaneAllocator } from './interchange-serial-lane-index.ts';
import { resolveSequenceTimingView } from './sequence-timing-model.ts';
import { portableFileStem } from './portable-file-stem.ts';
import { readMidiClip, readMidiTrack } from './midi-model.ts';
import { AafObjectWriter, AafWriteObject } from './aaf-object-writer.ts';
import { aafUnhex, aafUtf16 } from './aaf-object-table.ts';
import { aafWaveSummary, inspectAafWave } from './aaf-wave.ts';

type Data = Readonly<Record<string, unknown>>;
export interface AafExportRequest {
	readonly project: Data;
	readonly sequenceId?: string;
	readonly title?: string;
	/** Complete WAV files keyed by source ID. Absent bodies remain linked by filename. */
	readonly media?: ReadonlyMap<string, Uint8Array>;
}
export interface AafExportResult {
	readonly bytes: Uint8Array;
	readonly fileName: string;
	readonly mimeType: string;
	readonly report: DeliveryReport;
}

/** AAF 1.2 audio cut composition with composition/master/file mobs and WAV essence. */
export function createAafExport(request: AafExportRequest): AafExportResult {
	const { project } = request, sampleRate = integer(project.sampleRate, 'sample rate', 1);
	const title = String(request.title ?? project.title ?? 'Audio timeline');
	const writer = new AafObjectWriter(), composition = writer.mob(0x35, title), mobs = [composition], essenceObjects: AafWriteObject[] = [], slots: AafWriteObject[] = [];
	composition.raw(0x4408, aafUnhex('0201010d01010007060e2b3404010101')); // Usage_TopLevel
	const draft = createDeliveryReport({ format: 'aaf', container: 'AAF 1.2', codec: 'WAVE', sampleRate });
	const tracks = records(project.tracks), visibility = createInterchangeVisibility(tracks, project);
	const sources = new Map(records(project.sources).map(source => [String(source.id), source]));
	const clips = new Map(records(project.clips).map(clip => [String(clip.id), clip]));
	const sourceMobs = new Map<string, AafWriteObject>();
	let embeddedBytes = 0, extent = 0;
	function report(code: string, message: string, disposition: 'preserved' | 'converted' | 'missing' | 'omitted', scope: Data = {}, data: Data = {}): void {
		addDeliveryReportItem(draft, { code: `aaf.${code}`, message, disposition, severity: disposition === 'preserved' ? 'info' : 'warning', scope, data });
	}
	function sourceMob(sourceId: string): AafWriteObject | null {
		const known = sourceMobs.get(sourceId); if (known) return known;
		const source = sources.get(sourceId);
		if (!source) throw new ReferenceError(`AAF source ${sourceId} is missing.`);
		const rate = integer(source.sampleRate, 'source sample rate', 1), frames = integer(source.frameCount, 'source length', 1), channels = integer(source.channelCount, 'source channel count', 1);
		if (channels > 2) { report('multichannel-source-omitted', 'This AAF profile carries mono and stereo WAV sources.', 'omitted', { kind: 'media', id: sourceId }); return null; }
		let name = String(source.name ?? 'Audio.wav').split(/[\\/]/u).at(-1) || 'Audio.wav';
		const body = request.media?.get(sourceId);
		if (!/\.wave?$/iu.test(name)) {
			name = `${name.replace(/\.[^.]*$/u, '')}.wav`;
			report('source-format-converted', body ? 'The source is embedded as WAV audio.' : 'The linked source must be converted to WAV and relinked.', 'converted', { kind: 'media', id: sourceId });
		}
		const fileMob = writer.mob(0x37, name), descriptor = new AafWriteObject(0x2c);
		descriptor.rate(0x3001, rate); descriptor.int(0x3002, frames); descriptor.int(0x3006, 1, 4);
		if (body) {
			embeddedBytes += body.length;
			if (body.length > 256 * 1024 * 1024 || embeddedBytes > 480 * 1024 * 1024) throw new RangeError('AAF embedded audio exceeds its source or total byte limit.');
			const info = inspectAafWave(body, rate, channels, frames); descriptor.raw(0x3801, info.summary);
			if (String(source.sampleFormat ?? 'float32') !== info.sampleFormat) report('sample-format-converted', 'Source PCM is quantized to the embedded WAV sample format.', 'converted', { kind: 'media', id: sourceId }, { to: info.sampleFormat });
			const essence = new AafWriteObject(0x23); essence.raw(0x2701, fileMob.properties.get(0x4401)!.data); essence.stream(0x2702, body); essenceObjects.push(essence);
		} else {
			descriptor.raw(0x3801, aafWaveSummary(rate, channels, frames));
			const locator = new AafWriteObject(0x32); locator.text(0x4001, name); descriptor.refs(0x2f01, [locator]);
			report('media-linked', 'The receiving application must relink the named WAV source.', 'converted', { kind: 'media', id: sourceId }, { name });
		}
		fileMob.ref(0x4701, descriptor); fileMob.refs(0x4403, [writer.slot(writer.sourceClip(frames), rate, 1, name)]);
		const master = writer.mob(0x36, name); master.refs(0x4403, [writer.slot(writer.sourceClip(frames, fileMob), rate, 1, name)]);
		mobs.push(master, fileMob); sourceMobs.set(sourceId, master); return master;
	}
	for (const track of tracks) {
		const scope = { kind: 'track', id: String(track.id) };
		if (track.type !== 'audio') {
			if (Array.isArray(track.clipIds) && track.clipIds.length) report('track-kind-omitted', 'This AAF profile carries audio tracks only.', 'omitted', scope, { type: track.type });
			continue;
		}
		if (!visibility.contributes(track)) { report('silent-track-omitted', 'An inaudible track is excluded from the delivered edit.', 'omitted', scope); continue; }
		const members = (Array.isArray(track.clipIds) ? track.clipIds : []).map(id => {
			const clip = clips.get(String(id)); if (!clip) throw new ReferenceError(`AAF track references missing clip ${String(id)}.`); return clip;
		}).sort((a, b) => Number(a.timelineStartFrame) - Number(b.timelineStartFrame));
		if (readMidiTrack(track) || members.some(clip => readMidiClip(clip) || clip.midi)) report('midi-authoring-converted', 'MIDI notes, messages and instruments are delivered as fallback audio.', 'converted', scope);
		const allocate = createSerialLaneAllocator(), lanes: { components: AafWriteObject[]; end: number }[] = [];
		for (const clip of members) {
			const clipScope = { kind: 'clip', id: String(clip.id) };
			if (clip.kind !== 'audio') { report('clip-kind-omitted', 'A non-audio clip is omitted from this AAF audio profile.', 'omitted', clipScope); continue; }
			const start = integer(clip.timelineStartFrame, 'clip start'), duration = integer(clip.durationFrames, 'clip duration', 1), sourceStart = integer(clip.sourceStartFrame ?? 0, 'source offset');
			integer(start + duration, 'clip end');
			const media = sourceMob(String(clip.sourceId)); if (!media) continue;
			const laneId = allocate(start, start + duration), lane = lanes[laneId] ?? { components: [], end: 0 }; lanes[laneId] = lane;
			if (start > lane.end) lane.components.push(writer.component(0x09, start - lane.end));
			const segment = writer.sourceClip(duration, media, sourceStart);
			if (clip.title) {
				const name = new AafWriteObject(0x3f), text = aafUtf16(String(clip.title)), indirect = new Uint8Array(17 + text.length);
				indirect[0] = 0x4c; indirect.set(aafUnhex('0002100100000000060e2b3401040101'), 1); indirect.set(text, 17);
				name.text(0x5001, 'Soundscaper.ClipName'); name.raw(0x5003, indirect); segment.refs(0x0204, [name]);
			}
			lane.components.push(segment); lane.end = start + duration; extent = Math.max(extent, lane.end);
			if (interchangeClipTimeEffect(clip)) report('time-effect-omitted', 'Time effects are omitted; the cut references forward source audio at unity speed.', 'omitted', clipScope);
			if (clip.mute || clip.gain !== undefined && clip.gain !== 1 || clip.fadeInFrames || clip.fadeOutFrames || clip.pitchCents || clip.inverted || records(clip.effects).length || records(clip.envelope).length) report('clip-processing-omitted', 'Clip mute, gain, fades, pitch, polarity, envelopes and effects are omitted from this cut-only profile.', 'omitted', clipScope);
		}
		lanes.forEach((lane, i) => {
			const sequence = writer.component(0x0f, lane.end); sequence.refs(0x1001, lane.components);
			slots.push(writer.slot(sequence, sampleRate, slots.length + 1, `${String(track.name ?? 'Audio')}${i ? ` (${i + 1})` : ''}`));
		});
		if (lanes.length > 1) report('overlapping-track-split', 'Overlapping clips are preserved on separate AAF tracks.', 'converted', scope, { lanes: lanes.length });
		if (track.gain !== undefined && track.gain !== 1 || track.pan || records(track.effects).length || records(track.envelope).length) report('track-processing-omitted', 'Track gain, pan, effects and automation are omitted from this cut-only profile.', 'omitted', scope);
	}
	const audioTracks = slots.length;
	if (records(project.sequences).length) {
		const timing = resolveSequenceTimingView(project, request.sequenceId), timecode = writer.component(0x14, Math.ceil(extent * timing.rate.num / (sampleRate * timing.rate.den)), true);
		timecode.int(0x1501, timing.startFrameCount); timecode.int(0x1502, timing.nominalFrameRate, 2); timecode.int(0x1503, timing.dropFrame ? 1 : 0, 1);
		slots.push(writer.slot(timecode, timing.rate.num, slots.length + 1, 'Timecode', timing.rate.den));
	}
	composition.refs(0x4403, slots); writer.content.refs(0x1901, mobs, 0x4401); writer.content.refs(0x1902, essenceObjects, 0x2701);
	if (interchangeAnnotationOmission(project) || interchangeCaptionTrackOmission(project, request.sequenceId)) report('annotations-omitted', 'Timeline annotations, label tracks and captions are omitted from this AAF audio profile.', 'omitted');
	if (records(project.automationLanes).length || records(project.buses).length || records(project.masterEffects).length || project.masterGain !== undefined && project.masterGain !== 1) report('mix-processing-omitted', 'Mixer routing, master processing and project automation remain in the native project.', 'omitted');
	report('timeline-preserved', 'Audio cuts, source offsets, gaps and track names are represented in AAF.', 'preserved', {}, { tracks: audioTracks, sources: sourceMobs.size });
	return { bytes: writer.finish(), fileName: `${portableFileStem(title, 'timeline')}.aaf`, mimeType: 'application/octet-stream', report: sealDeliveryReport(draft) };
}

function records(value: unknown): Data[] { return Array.isArray(value) ? value.filter((item): item is Data => item !== null && typeof item === 'object' && !Array.isArray(item)) : []; }
function integer(value: unknown, name: string, minimum = 0): number {
	const n = Number(value);
	if (!Number.isSafeInteger(n) || n < minimum) throw new RangeError(`AAF ${name} must be a non-negative exact integer.`);
	return n;
}
