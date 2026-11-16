/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseArdourDocument } from '../src/common/editor/ardour-import.ts';
import { openSoundcraftBundle } from '../src/common/editor/soundcraft-bundle.ts';
import { buildTimelineInterchangeProject } from '../src/common/editor/timeline-interchange-project.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { readMidiClip, readMidiTrack } from '../src/common/editor/midi-model.ts';

// Pinned upstream bytes are downloaded for this audit, never redistributed.
const ardourUrl = 'https://raw.githubusercontent.com/Ardour/ardour/522303bf7cbfd7d74510eb96e7da0762ffa73237/libs/pbd/test/TestSession.ardour';
const response = await fetch(ardourUrl);
if (!response.ok) throw new Error(`Ardour reference download failed: ${response.status}.`);
const bytes = new Uint8Array(await response.arrayBuffer());
assert.equal(createHash('sha256').update(bytes).digest('hex'), '6f44bda6e35ae06d695e40d0a466809fba1811fd8088840b012c387adecd6ea8');
const document = parseArdourDocument(new TextDecoder().decode(bytes));
assert.equal(document.sampleRate, 44100);
assert.equal(document.tracks.length, 8);
assert.equal(document.tracks.reduce((sum, track) => sum + track.clips.length, 0), 93);
assert.equal(document.media.length, 52);
assert.equal(document.master?.gain, 0.888838410378, 'the pinned legacy master IO fader must survive import');
let next = 0;
const project = createCurrentAudioEditorProject(buildTimelineInterchangeProject(document, { createStableId: prefix => `${prefix}-${++next}` }).project);
const phrase = project.clips.find(clip => clip.title === 'Vocal1-3.1');
assert.equal(phrase?.timelineStartFrame, 278705475);
assert.equal(phrase?.durationFrames, 8407596);
assert.equal(phrase?.sourceStartFrame, 0);

// Python's standard library supplies an independent ZIP writer and WAV payload.
const directory = await mkdtemp(join(tmpdir(), 'native-daw-audit-'));
try {
	const path = join(directory, 'reference.scraftz');
	await promisify(execFile)(process.env.PYTHON || 'python3', ['-c', String.raw`
import io,json,struct,sys,wave,zipfile
audio=io.BytesIO()
with wave.open(audio,'wb') as wav:
 wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(48000)
 wav.writeframes(struct.pack('<h',8192)*48000)
session={'format_version':1,'name':'Independent bundle','sample_rate':48000,'frame_rate':'Fps25',
 'sources':[{'id':1,'name':'Voice','path':'Audio Files/voice.wav','frames':48000,'sample_rate':48000}],
 'tracks':[{'id':2,'name':'Voice','kind':'Audio','active_playlist':0,
  'mixer':{'pan':[0],'output':'Main'},'playlists':[{'clips':[{'id':3,'name':'Phrase',
   'start':24000,'length':24000,'content':{'Audio':{'source':1,'offset':12000}}}]}]}]}
session['tempo']={'tempos':[{'tick':0,'bpm':60}],'meters':[{'tick':0,'numerator':4,'denominator':4}]}
session['tracks'].append({'id':4,'name':'Keys','kind':'Midi','active_playlist':0,
 'mixer':{'pan':[0],'output':'Main'},'playlists':[{'clips':[{'id':5,'name':'Notes','start':48000,'length':96000,
 'content':{'Midi':{'sequence':{'notes':[{'pitch':67,'velocity':96,'release_velocity':24,'channel':3,'start':480,'length':960}],
 'ctrls':[{'tick':0,'channel':3,'kind':'Program','value':8}]}}}}]}]})
with zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_DEFLATED) as archive:
 for name,data in [('Reference.scraft',json.dumps(session).encode()),('Audio Files/voice.wav',audio.getvalue())]:
  info=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0)); info.compress_type=zipfile.ZIP_DEFLATED
  archive.writestr(info,data)
`, path]);
	const archive = await openSoundcraftBundle(new Blob([await readFile(path)]));
	try {
		assert.equal(archive.document.title, 'Independent bundle');
		const clip = archive.document.tracks[0]?.clips[0];
		assert.deepEqual(clip?.start, { num: 1, den: 2 });
		assert.deepEqual(clip?.sourceStart, { num: 1, den: 4 });
		assert.equal((await archive.readMedia('Audio Files/voice.wav'))?.size, 96044);
		const imported = createCurrentAudioEditorProject(buildTimelineInterchangeProject(archive.document, { createStableId: prefix => `${prefix}-${++next}` }).project);
		assert.equal(readMidiTrack(imported.tracks[1])?.instrument, 'triangle');
		assert.deepEqual(readMidiClip(imported.clips[1])?.notes.map(note => [note.pitch, note.channel, note.velocity, note.releaseVelocity, note.startFrame, note.durationFrames]),
			[[67, 3, 96, 24, 24000, 48000]]);
		assert.deepEqual(readMidiClip(imported.clips[1])?.interchange?.events, [{ frame: 0, status: 0xc3, data: [8] }]);
	} finally { await archive.close(); }
} finally { await rm(directory, { recursive: true, force: true }); }
console.log('Native DAW audit passed: pinned Ardour snapshot and independent Python SoundCraft ZIP.');
