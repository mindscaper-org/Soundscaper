/* SPDX-License-Identifier: AGPL-3.0-only */
import { OmfObjectWriter, omfWaveSummary } from '../../src/common/editor/omf-object-writer.ts';
import { encodeWav } from '../../src/common/editor/wav.js';

/** Standard OMF mono file slots select channels of the same interleaved essence. */
export function omfPhysicalChannelBytes(channels: readonly number[], embedded = true, stereo = false): Uint8Array {
	const writer = new OmfObjectWriter(), head = writer.object('HEAD', 1), sound = writer.object('DDEF');
	writer.raw(head, 'HEAD:Version', 'VersionType', Uint8Array.of(2, 0));
	writer.text(sound, 'DDEF:DataKindID', stereo ? 'omfi:data:StereoSound' : 'omfi:data:Sound', 'UniqueName');
	const composition = writer.mob('CMOB', 'Channel edit'), master = writer.mob('MMOB', 'Stereo recording'), file = writer.mob('SMOB', 'Stereo.wav');
	const sourceClip = (mob: number, track: number) => {
		const clip = writer.component('SCLP', sound, 4800); writer.uid(clip, 'SCLP:SourceID', mob);
		writer.int(clip, 'SCLP:SourceTrackID', track, 'UInt32'); writer.int(clip, 'SCLP:StartTime', 0, 'Position32'); return clip;
	};
	const slot = (segment: number, track: number, physical?: number) => {
		const description = writer.object('TRKD'); writer.int(description, 'TRKD:TrackID', track, 'UInt32');
		writer.int(description, 'TRKD:Origin', 0, 'Position32'); writer.text(description, 'TRKD:TrackName', `Channel ${String(track)}`);
		if (physical !== undefined) writer.int(description, 'TRKD:PhysicalTrack', physical, 'UInt32');
		const result = writer.object('MSLT'); writer.rate(result, 'MSLT:EditRate', 48000);
		writer.ref(result, 'MSLT:Segment', [segment]); writer.ref(result, 'MSLT:TrackDesc', [description]); return result;
	};
	writer.ref(file, 'MOBJ:Slots', stereo ? [slot(sourceClip(0, 0), 1, 1)] : [slot(sourceClip(0, 0), 1, 1), slot(sourceClip(0, 0), 2, 2)], true);
	writer.ref(master, 'MOBJ:Slots', [slot(sourceClip(file, 1), 1), slot(sourceClip(file, 2), 2)], true);
	writer.ref(composition, 'MOBJ:Slots', channels.map((channel, index) => slot(sourceClip(master, channel), index + 1)), true);
	const descriptor = writer.object('WAVD'); writer.rate(descriptor, 'MDFL:SampleRate', 48000); writer.int(descriptor, 'MDFL:Length', 4800);
	writer.raw(descriptor, 'WAVD:Summary', 'DataValue', omfWaveSummary(48000, 2, 4800)); writer.ref(file, 'SMOB:MediaDescription', [descriptor]);
	if (embedded) {
		const body = writer.object('WAVE'); writer.uid(body, 'MDAT:MobID', file); writer.raw(body, 'WAVE:AudioData', 'DataValue', omfPhysicalChannelWave());
		writer.ref(head, 'HEAD:MediaData', [body], true);
	} else {
		const locator = writer.object('UNXL'); writer.text(locator, 'UNXL:PathName', 'Stereo.wav'); writer.ref(descriptor, 'MDES:Locator', [locator], true);
	}
	writer.ref(head, 'HEAD:Mobs', [composition, master, file], true); writer.ref(head, 'HEAD:PrimaryMobs', [composition], true);
	return writer.finish();
}

export function omfPhysicalChannelWave(): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(encodeWav([new Float32Array(4800).fill(.125), new Float32Array(4800).fill(.375)], { sampleRate: 48000, float: true }));
}
