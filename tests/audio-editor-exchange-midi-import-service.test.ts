/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { exchangeMidiBytes, midiAttachmentAaf, midiReferenceOtio } from './helpers/interchange-midi-file-fixtures.ts';

function ids() { let id = 0; return (prefix: string) => `${prefix}-${++id}`; }

for (const kind of ['embedded AAF', 'linked AAF', 'OTIO', 'sniffed OTIO'] as const) test(`${kind} MIDI is persisted before activation`, async () => {
	const fixture = createFixture({ createStableId: ids() }), written: string[] = [];
	fixture.runtime.store.writeMidiSource = async (id, recipe) => {
		written.push(id); assert.equal(recipe.sampleRate, 48000); return { channelCount: 1, chunkFrames: 1024 };
	};
	const activate = fixture.runtime.switchProject;
	const runtime: typeof fixture.runtime = { ...fixture.runtime, switchProject: async (project, options) => {
		assert.equal(written.length, 2); await activate(project, options);
	} };
	const aaf = kind.includes('AAF'), name = kind === 'sniffed OTIO' ? 'Score.data' : 'Score.mid';
	const file = aaf ? new File([midiAttachmentAaf({ embedded: kind === 'embedded AAF' })], 'Score.aaf')
		: new File([midiReferenceOtio(name)], 'Score.otio');
	const result = await createNativeProjectService(runtime).openInterchange(file, { mediaFiles: [new File([exchangeMidiBytes()], name)] });
	assert.ok(result);
	assert.deepEqual(result.project.clips.map(clip => readMidiClip(clip)?.notes[0]?.pitch), [64, 48]);
	assert.ok(result.project.sources.every(source => 'chunkFrames' in source && source.chunkFrames === 1024));
	assert.equal(result.report.items.some(item => item.disposition === 'missing'), false);
});

test('exchange MIDI source persistence rolls back when activation fails', async () => {
	const fixture = createFixture({ createStableId: ids(), switchProject: async () => { throw new Error('activation failed'); } });
	fixture.runtime.store.writeMidiSource = async () => ({ channelCount: 1, chunkFrames: 1024 });
	await assert.rejects(createNativeProjectService(fixture.runtime).openInterchange(new File([midiAttachmentAaf()], 'Score.aaf')), /activation failed/u);
	assert.equal(fixture.deletedSources.length, 2);
	assert.equal(fixture.state.importing, false);
});

test('malformed linked MIDI fails before publishing a replacement project', async () => {
	const fixture = createFixture({ createStableId: ids() });
	const previous = fixture.runtime.getProject();
	await assert.rejects(createNativeProjectService(fixture.runtime).openInterchange(new File([midiReferenceOtio()], 'Score.otio'),
		{ mediaFiles: [new File(['invalid'], 'Score.mid')] }), /MIDI|truncated/iu);
	assert.equal(fixture.runtime.getProject(), previous);
	assert.equal(fixture.state.importing, false);
});
