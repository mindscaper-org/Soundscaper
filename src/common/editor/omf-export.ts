/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport, type DeliveryReport } from './delivery-report.ts';
import { interchangeClipTimeEffect } from './interchange-omission-inventory.ts';
import { createInterchangeVisibility } from './interchange-track-visibility.ts';
import { interchangeSourceInPoint } from './interchange-source-in-point.ts';
import { createSerialLaneAllocator } from './interchange-serial-lane-index.ts';
import { portableFileStem } from './portable-file-stem.ts';
import { readMidiClip, readMidiTrack } from './midi-model.ts';
import { OmfObjectWriter, omfWaveSummary } from './omf-object-writer.ts';
import { resolveSequenceTimingView } from './sequence-timing-model.ts';

type Data = Readonly<Record<string, unknown>>;
export interface OmfExportRequest {
	readonly project: Data;
	readonly sequenceId?: string;
	readonly title?: string;
	/** Whole-source WAV files keyed by source ID; omitted entries remain linked. */
	readonly media?: ReadonlyMap<string, Uint8Array>;
}
export interface OmfExportResult {
	readonly bytes: Uint8Array;
	readonly fileName: string;
	readonly mimeType: string;
	readonly report: DeliveryReport;
}

/** OMF2 cut-only audio composition, with standard embedded or linked WAV essence. */
export function createOmfExport(request: OmfExportRequest): OmfExportResult {
	const { project } = request, sampleRate = integer(project.sampleRate, 'sample rate', 1);
	const title = String(request.title ?? project.title ?? 'Audio timeline');
	const draft = createDeliveryReport({ format: 'omf', container: 'OMF 2.0', codec: 'WAVE', sampleRate });
	const writer = new OmfObjectWriter(), head = writer.object('HEAD', 1);
	writer.raw(head, 'HEAD:Version', 'VersionType', Uint8Array.of(2, 0));
	writer.raw(head, 'HEAD:ByteOrder', 'Int16', Uint8Array.of(0x49, 0x49));
	writer.raw(head, 'HEAD:LastModified', 'TimeStamp', Uint8Array.of(0, 0, 0, 0, 1));
	const mono = writer.object('DDEF'), stereo = writer.object('DDEF');
	writer.text(mono, 'DDEF:DataKindID', 'omfi:data:Sound', 'UniqueName');
	writer.text(stereo, 'DDEF:DataKindID', 'omfi:data:StereoSound', 'UniqueName');
	const definitions = [mono, stereo];
	const composition = writer.mob('CMOB', title), mobs = [composition], mediaObjects: number[] = [], slots: number[] = [];
	writer.int(composition, 'CMOB:UsageCode', 0, 'UInt32');
	const sources = new Map(records(project.sources).map((source) => [String(source.id), source]));
	const clips = new Map(records(project.clips).map((clip) => [String(clip.id), clip]));
	const sourceMobs = new Map<string, { id: number; kind: number; rate: number }>();
	const tracks = records(project.tracks), visibility = createInterchangeVisibility(tracks, project);
	let embeddedSize = 0;
	function report(code: string, message: string, disposition: 'omitted' | 'converted' | 'missing' | 'preserved', scope: Data = {}, data: Data = {}): void {
		addDeliveryReportItem(draft, { code: `omf.${code}`, message, disposition, severity: disposition === 'preserved' ? 'info' : 'warning', scope, data });
	}
	function sourceMob(sourceId: string): { id: number; kind: number; rate: number } | null {
		const known = sourceMobs.get(sourceId); if (known) return known;
		const source = sources.get(sourceId);
		if (!source) { report('media-missing', 'The source is unavailable; its clips are omitted.', 'missing', { kind: 'media', id: sourceId }); return null; }
		const channelCount = integer(source.channelCount ?? 1, 'source channel count', 1);
		if (channelCount > 2) { report('multichannel-source-omitted', 'This OMF profile supports mono and stereo WAV sources.', 'omitted', { kind: 'media', id: sourceId }); return null; }
		const rate = integer(source.sampleRate ?? sampleRate, 'source sample rate', 1);
		const frameCount = integer(source.frameCount ?? maximumSourceExtent(sourceId, clips.values()), 'source length', 1);
		const kind = channelCount === 2 ? stereo : mono;
		let name = String(source.name ?? `${sourceId}.wav`).split(/[\\/]/u).at(-1) || `${sourceId}.wav`;
		const essence = request.media?.get(sourceId);
		if (essence) {
			embeddedSize += essence.length;
			if (embeddedSize > 512 * 1024 * 1024 || essence.length > 256 * 1024 * 1024) throw new RangeError('OMF embedded media exceeds the bounded 512 MiB total or 256 MiB source limit.');
		}
		if (!/\.wave?$/iu.test(name)) { name = `${name.replace(/\.[^.]*$/u, '')}.wav`; report('source-format-converted', essence ? 'The source is embedded as WAV audio.' : 'This linked OMF requires WAV media; convert and relink the named source.', 'converted', { kind: 'media', id: sourceId }, { name }); }
		const fileMob = writer.mob('SMOB', name), descriptor = writer.object('WAVD');
		writer.ref(fileMob, 'SMOB:MediaDescription', [descriptor]);
		writer.rate(descriptor, 'MDFL:SampleRate', rate); writer.int(descriptor, 'MDFL:Length', frameCount);
		writer.raw(descriptor, 'MDFL:IsOMFI', 'Boolean', Uint8Array.of(essence ? 1 : 0));
		const wave = essence ? waveSummary(essence, rate, channelCount, frameCount) : null;
		writer.raw(descriptor, 'WAVD:Summary', 'DataValue', wave?.summary ?? omfWaveSummary(rate, channelCount, frameCount, String(source.sampleFormat ?? 'float32')));
		if (wave && wave.sampleFormat !== String(source.sampleFormat ?? 'float32')) report('sample-format-converted', 'Source audio is converted to the embedded WAV sample format.', 'converted', { kind: 'media', id: sourceId }, { from: source.sampleFormat ?? 'float32', to: wave.sampleFormat });
		if (essence) {
			const data = writer.object('WAVE'); writer.uid(data, 'MDAT:MobID', fileMob); writer.raw(data, 'WAVE:AudioData', 'DataValue', essence); mediaObjects.push(data);
		} else {
			const locator = writer.object('UNXL'); writer.text(locator, 'UNXL:PathName', name); writer.ref(descriptor, 'MDES:Locator', [locator], true);
			report('media-linked', 'Media is referenced by filename; relink the original WAV source in the receiving application.', 'converted', { kind: 'media', id: sourceId }, { name });
		}
		writer.ref(fileMob, 'MOBJ:Slots', [writer.slot(writer.sourceClip(kind, frameCount, 0), rate, 1, name)], true);
		const master = writer.mob('MMOB', name); writer.ref(master, 'MOBJ:Slots', [writer.slot(writer.sourceClip(kind, frameCount, fileMob), rate, 1, name)], true);
		mobs.push(master, fileMob); const result = { id: master, kind, rate }; sourceMobs.set(sourceId, result); return result;
	}
	for (const track of tracks) {
		if (track.type !== 'audio') {
			if (Array.isArray(track.clipIds) && track.clipIds.length) report('track-kind-omitted', 'The OMF profile carries audio tracks only.', 'omitted', { kind: 'track', id: String(track.id) }, { type: track.type });
			continue;
		}
		if (!visibility.contributes(track)) { report('silent-track-omitted', 'An inaudible track is excluded from the delivered edit.', 'omitted', { kind: 'track', id: String(track.id) }); continue; }
		const members = (Array.isArray(track.clipIds) ? track.clipIds : []).map((id) => {
			const clip = clips.get(String(id)); if (!clip) throw new ReferenceError(`OMF track references missing clip ${String(id)}.`); return clip;
		}).sort((a, b) => Number(a.timelineStartFrame) - Number(b.timelineStartFrame));
		if (readMidiTrack(track) || members.some((clip) => readMidiClip(clip) || clip.midi)) report('midi-authoring-converted', 'MIDI notes, messages and instruments are delivered as fallback audio; editable MIDI remains in the native project.', 'converted', { kind: 'track', id: String(track.id) });
		const allocate = createSerialLaneAllocator(), lanes: { components: number[]; end: number; kind: number }[] = [];
		for (const clip of members) {
			if (clip.kind !== 'audio') { report('clip-kind-omitted', 'A non-audio clip is omitted from this OMF audio profile.', 'omitted', { kind: 'clip', id: String(clip.id) }); continue; }
			const start = integer(clip.timelineStartFrame, 'clip start'), duration = integer(clip.durationFrames, 'clip duration', 1);
			integer(start + duration, 'clip end');
			const media = sourceMob(String(clip.sourceId)); if (!media) continue;
			const source = sources.get(String(clip.sourceId)), sourceStart = interchangeSourceInPoint(clip, source, { num: sampleRate, den: 1 }, sampleRate);
			integer(sourceStart, 'source offset');
			if (Number(clip.sourceStartFrame ?? 0) * sampleRate % media.rate !== 0) report('source-offset-rounded', 'The source offset is rounded to the OMF composition edit-unit grid.', 'converted', { kind: 'clip', id: String(clip.id) });
			const laneId = allocate(start, start + duration), lane = lanes[laneId] ?? { components: [], end: 0, kind: media.kind };
			lanes[laneId] = lane;
			if (start > lane.end) lane.components.push(writer.component('FILL', lane.kind, start - lane.end));
			const segment = writer.sourceClip(media.kind, duration, media.id, sourceStart); writer.text(segment, 'CPNT:Name', String(clip.title ?? source?.name ?? clip.id));
			lane.components.push(segment); lane.end = start + duration;
			if (interchangeClipTimeEffect(clip)) report('time-effect-omitted', 'Time effects are not represented; the cut references forward source audio at unity speed.', 'omitted', { kind: 'clip', id: String(clip.id) });
			if (clip.mute === true || clip.gain !== undefined && clip.gain !== 1 || clip.fadeInFrames || clip.fadeOutFrames || Array.isArray(clip.effects) && clip.effects.length) report('clip-processing-omitted', 'Clip gain, mute, fades and effects are not represented by this cut-only profile.', 'omitted', { kind: 'clip', id: String(clip.id) });
		}
		lanes.forEach((lane, index) => {
			const sequence = writer.component('SEQU', lane.kind, lane.end); writer.ref(sequence, 'SEQU:Components', lane.components, true);
			slots.push(writer.slot(sequence, sampleRate, slots.length + 1, `${String(track.name ?? 'Audio')}${index ? ` (${index + 1})` : ''}`));
		});
		if (lanes.length > 1) report('overlapping-track-split', 'Overlapping clips are preserved on separate OMF tracks.', 'converted', { kind: 'track', id: String(track.id) }, { lanes: lanes.length });
		if (track.gain !== undefined && track.gain !== 1 || track.pan || Array.isArray(track.effects) && track.effects.length || Array.isArray(track.envelope) && track.envelope.length) report('track-processing-omitted', 'Track gain, pan, effects and automation are not represented by this cut-only profile.', 'omitted', { kind: 'track', id: String(track.id) });
	}
	const audioTrackCount = slots.length;
	if (records(project.sequences).length) {
		const timing = resolveSequenceTimingView(project, request.sequenceId), definition = writer.object('DDEF');
		definitions.push(definition);
		writer.text(definition, 'DDEF:DataKindID', 'omfi:data:Timecode', 'UniqueName');
		const extent = records(project.clips).reduce((end, clip) => Math.max(end, Number(clip.timelineStartFrame ?? 0) + Number(clip.durationFrames ?? 0)), 0);
		const length = integer(Math.ceil(extent * timing.rate.num / (sampleRate * timing.rate.den)), 'timecode length');
		const timecode = writer.component('TCCP', definition, length);
		writer.int(timecode, 'TCCP:Start', timing.startFrameCount, 'Position32'); writer.int(timecode, 'TCCP:FPS', timing.nominalFrameRate, 'UInt16', 2);
		writer.raw(timecode, 'TCCP:Drop', 'Boolean', Uint8Array.of(timing.dropFrame ? 1 : 0));
		slots.push(writer.slot(timecode, timing.rate.num, slots.length + 1, 'Timecode', timing.rate.den));
	}
	writer.ref(head, 'HEAD:DefinitionObjects', definitions, true);
	writer.ref(composition, 'MOBJ:Slots', slots, true); writer.ref(head, 'HEAD:Mobs', mobs, true);
	writer.ref(head, 'HEAD:PrimaryMobs', [composition], true); writer.ref(head, 'HEAD:MediaData', mediaObjects, true);
	if (records(project.timelineAnnotations).length || records(project.videoCaptionTracks).length) report('annotations-omitted', 'Timeline annotations and captions are not represented by this OMF audio profile.', 'omitted');
	report('timeline-preserved', 'Audio cuts, source offsets, gaps and track names are represented in OMF2.', 'preserved', {}, { tracks: audioTrackCount, sources: sourceMobs.size });
	return { bytes: writer.finish(), fileName: `${portableFileStem(title, 'timeline')}.omf`, mimeType: 'application/octet-stream', report: sealDeliveryReport(draft) };
}

function records(value: unknown): Data[] { return Array.isArray(value) ? value.filter((item): item is Data => Boolean(item) && typeof item === 'object') : []; }
function integer(value: unknown, name: string, minimum = 0): number {
	const n = Number(value); if (!Number.isSafeInteger(n) || n < minimum || n > 0x7fff_ffff) throw new RangeError(`OMF ${name} must fit a positive 32-bit edit-unit value.`); return n;
}
function maximumSourceExtent(sourceId: string, clips: Iterable<Data>): number {
	let length = 1;
	for (const clip of clips) if (String(clip.sourceId) === sourceId) length = Math.max(length, Number(clip.sourceStartFrame ?? 0) + Number(clip.durationFrames ?? 0));
	return length;
}
function waveSummary(bytes: Uint8Array, rate: number, channels: number, frames: number): { summary: Uint8Array; sampleFormat: string } {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
	if (bytes.length < 44 || decoder.decode(bytes.subarray(0, 4)) !== 'RIFF' || decoder.decode(bytes.subarray(8, 12)) !== 'WAVE') throw new TypeError('OMF embedded essence must be a RIFF WAVE file.');
	let format = false, blockAlign = 0, sampleFormat = '';
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const tag = decoder.decode(bytes.subarray(offset, offset + 4)), size = view.getUint32(offset + 4, true);
		if (offset + 8 + size > bytes.length) throw new RangeError('Truncated OMF embedded WAVE chunk.');
		if (tag === 'fmt ') {
			if (size < 16 || view.getUint16(offset + 10, true) !== channels || view.getUint32(offset + 12, true) !== rate) throw new RangeError('OMF embedded WAVE geometry disagrees with its source.');
			blockAlign = view.getUint16(offset + 20, true);
			const bits = view.getUint16(offset + 22, true), code = view.getUint16(offset + 8, true);
			if (![1, 3, 65_534].includes(code) || ![8, 16, 24, 32, 64].includes(bits) || blockAlign !== channels * bits / 8) throw new TypeError('OMF embedded WAVE must contain uncompressed audio.');
			sampleFormat = `${code === 3 ? 'float' : 'int'}${bits}`;
			format = true;
		}
		if (tag === 'data') {
			if (!format || size !== frames * blockAlign) throw new RangeError('OMF embedded WAVE length disagrees with its source.');
			return { summary: bytes.slice(0, offset + 8), sampleFormat };
		}
		offset += 8 + size + (size & 1);
	}
	throw new TypeError('OMF embedded WAVE has no audio data chunk.');
}
