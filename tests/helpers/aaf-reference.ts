/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { interchangePythonExecutable } from '../../scripts/lib/interchange-python.mjs';

const referenceRoot = resolve(import.meta.dirname, '../../vendor/interchange-conformance');

/** Execute only the independently provisioned AAF implementation; production has no Python dependency. */
export function withAafReference<T>(script: string, consume: (path: string, stdout: string) => T, input?: Uint8Array): T {
	const directory = mkdtempSync(join(tmpdir(), 'soundscaper-aaf-reference-')), path = join(directory, 'subject.aaf');
	try {
		if (input) writeFileSync(path, input);
		const stdout = execFileSync(interchangePythonExecutable({ referenceRoot }), ['-c', `import aaf2, sys, json\n${script}`, path], {
			env: { ...process.env, PYTHONPATH: referenceRoot, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
		});
		return consume(path, stdout);
	} catch (error) {
		throw new Error('AAF reference conformance failed. Provision with npm run provision:interchange-conformance.', { cause: error });
	} finally { rmSync(directory, { recursive: true, force: true }); }
}

export function createReferenceAaf(scenario = 'pcm'): Uint8Array {
	return withAafReference(`
import wave, os
path = sys.argv[1]
wav = os.path.join(os.path.dirname(path), 'Voice.wav')
with wave.open(wav, 'wb') as w:
    w.setparams((1, 2, 44100, 44100, 'NONE', 'not compressed'))
    w.writeframes(b'\\x00\\x20' * 44100)
with aaf2.open(path, 'w', extensions=False, sector_size=512 if ${JSON.stringify(scenario)} == 'legacy' else 4096) as f:
    master = f.create.MasterMob('Reference voice')
    f.content.mobs.append(master)
    master.import_audio_essence(wav)
    composition = f.create.CompositionMob('Independent AAF')
    composition.usage = 'Usage_TopLevel'
    f.content.mobs.append(composition)
    slot = composition.create_timeline_slot(48000)
    slot.name = 'Dialogue'
    seq = f.create.Sequence('sound')
    slot.segment = seq
    seq.components.append(f.create.Filler('sound', 24000))
    clip = f.create.SourceClip(start=11025, length=24000, mob_id=master.mob_id, slot_id=1, media_kind='sound')
    if ${JSON.stringify(scenario)} == 'effect':
        definition = f.create.OperationDef('9d2ea894-0968-11d3-8a38-0050040ef7d2', 'OperationDef_MonoAudioGain')
        definition.media_kind = 'sound'
        definition.number_inputs = 1
        f.dictionary.register_def(definition)
        group = f.create.OperationGroup(definition, length=24000, media_kind='sound')
        group['InputSegments'].append(clip)
        seq.components.append(group)
    else:
        seq.components.append(clip)
    if ${JSON.stringify(scenario)} == 'missing':
        for source in list(f.content.sourcemobs()):
            f.content.mobs.pop(source.mob_id)
        f.content.essencedata.clear()
    seq.length = 48000
`, path => new Uint8Array(readFileSync(path)));
}
