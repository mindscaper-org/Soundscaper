/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFileSync } from 'node:fs';
import { withAafReference } from './aaf-reference.ts';

/** Independently authored AAF with distinct supported WAV descriptors on one file mob. */
export function aafMultipleDescriptorBytes(reverse = false, repeated = false): Uint8Array {
	return withAafReference(`
import os, wave
from aaf2.ama import get_wave_fmt
with aaf2.open(sys.argv[1], 'w', extensions=False) as f:
    source = f.create.SourceMob('Linked recordings'); f.content.mobs.append(source)
    multiple = f.create.MultipleDescriptor(); multiple['SampleRate'].value = 48000; multiple['Length'].value = 4800
    source.descriptor = multiple
    for index, (name, sample) in enumerate([('First.wav', 4096), ('Second.wav', 12288)], 1):
        path = os.path.join(os.path.dirname(sys.argv[1]), name)
        with wave.open(path, 'wb') as audio:
            audio.setparams((1, 2, 48000, 4800, 'NONE', 'not compressed'))
            audio.writeframes(int(sample).to_bytes(2, 'little', signed=True) * 4800)
        descriptor = f.create.WAVEDescriptor(); descriptor['SampleRate'].value = 48000; descriptor['Length'].value = 4800
        descriptor['LinkedSlotID'].value = index; descriptor['Summary'].value = get_wave_fmt(path)
        locator = f.create.NetworkLocator(); locator['URLString'].value = name; descriptor['Locator'].append(locator)
        multiple['FileDescriptors'].append(descriptor)
        slot = source.create_timeline_slot(48000, slot_id=index)
        slot.segment = f.create.SourceClip(start=0, length=4800, media_kind='sound')
    composition = f.create.CompositionMob('Two linked recordings'); f.content.mobs.append(composition)
    for index in ${repeated ? '[1, 1]' : reverse ? '[2, 1]' : '[1, 2]'}:
        slot = composition.create_timeline_slot(48000); slot.name = 'Recording ' + str(index)
        slot.segment = f.create.SourceClip(start=0, length=4800, mob_id=source.mob_id, slot_id=index, media_kind='sound')
    for mob in f.content.mobs:
        for obj, streams in mob.walk_references(): obj.validate()
`, path => Uint8Array.from(readFileSync(path)));
}
