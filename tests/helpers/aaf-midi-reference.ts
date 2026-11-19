/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { withAafReference } from './aaf-reference.ts';
import { exchangeMidiBytes } from './interchange-midi-file-fixtures.ts';

/** pyaaf2 writes and validates this AS-01 attachment independently of our object writer. */
export function createReferenceMidiAaf(options: Readonly<{ embedded?: boolean; audio?: boolean; slotKind?: 'static' | 'timeline' | 'event' }> = {}): Uint8Array<ArrayBuffer> {
	return withAafReference(`
import os, wave
with aaf2.open(sys.argv[1], 'w', extensions=False) as f:
    composition = f.create.CompositionMob('Independent MIDI exchange')
    composition.usage = 'Usage_TopLevel'
    f.content.mobs.append(composition)
    if ${options.audio ? 'True' : 'False'}:
        wav = os.path.join(os.path.dirname(sys.argv[1]), 'Voice.wav')
        with wave.open(wav, 'wb') as w:
            w.setparams((1, 2, 48000, 48000, 'NONE', 'not compressed'))
            w.writeframes(b'\\x00\\x20' * 48000)
        master = f.create.MasterMob('Voice')
        f.content.mobs.append(master)
        master.import_audio_essence(wav)
        audio_slot = composition.create_timeline_slot(48000)
        audio_slot.name = 'Dialogue'
        audio_slot.segment = f.create.SourceClip(start=0, length=48000, mob_id=master.mob_id, slot_id=1, media_kind='sound')
    source = f.create.SourceMob('Score.mid')
    source.descriptor = f.create.AuxiliaryDescriptor()
    source.descriptor['MimeType'].value = 'audio/midi'
    locator = f.create.NetworkLocator()
    locator['URLString'].value = 'file:///MIDI/Score.mid'
    source.descriptor['Locator'].append(locator)
    f.content.mobs.append(source)
    source_slot = f.create.StaticMobSlot(slot_id=1)
    source_slot.name = 'MIDI file'
    source_slot.segment = f.create.SourceClip(length=0, media_kind='auxiliary')
    source.slots.append(source_slot)
    kind = ${JSON.stringify(options.slotKind ?? 'static')}
    if kind == 'timeline':
        slot = composition.create_timeline_slot(25)
    elif kind == 'event':
        slot = f.create.EventMobSlot(slot_id=10)
        slot['EditRate'].value = 25
        composition.slots.append(slot)
    else:
        slot = f.create.StaticMobSlot(slot_id=10)
        composition.slots.append(slot)
    slot.name = 'Music'
    slot.segment = f.create.SourceClip(length=0, mob_id=source.mob_id, slot_id=1, media_kind='auxiliary')
    if ${options.embedded === false ? 'False' : 'True'}:
        essence = f.create.EssenceData()
        essence.mob_id = source.mob_id
        f.content.essencedata.append(essence)
        essence.open('w').write(bytes.fromhex(${JSON.stringify(Buffer.from(exchangeMidiBytes()).toString('hex'))}))
    for mob in f.content.mobs:
        for obj, streams in mob.walk_references():
            obj.validate()
`, path => new Uint8Array(readFileSync(path)));
}
