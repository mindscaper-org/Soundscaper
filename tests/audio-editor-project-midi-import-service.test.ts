/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { readMidiClip } from '../src/common/editor/midi-model.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { soundcraftMidiSession, ardourMidiSession, ardourMidiBytes } from './helpers/project-midi-import-fixtures.ts';
import type { MidiSourceRecipe } from '../src/common/editor/storage/midi-source.ts';

function ids() { let id = 0; return (prefix: string) => `${prefix}-${++id}`; }
function soundcraft() {
	const session = soundcraftMidiSession();
	return new File([JSON.stringify({ ...session, tracks: [session.tracks[1]] })], 'notes.scraft');
}

for (const format of ['ardour', 'scraft'] as const) test(`${format} persists MIDI recipes before activation`, async () => {
	const recipes: MidiSourceRecipe[] = [];
	const fixture = createFixture({ createStableId: ids() });
	const activate = fixture.runtime.switchProject;
	const runtime: typeof fixture.runtime = { ...fixture.runtime,
		switchProject: async (project, options) => { assert.equal(recipes.length, 1); await activate(project, options); } };
	fixture.runtime.store.writeMidiSource = async (_id, recipe) => { recipes.push(recipe); return { channelCount: 1, chunkFrames: 1024 }; };
	const result = await createNativeProjectService(runtime).openInterchange(format === 'ardour'
		? new File([ardourMidiSession()], 'notes.ardour') : soundcraft(), { mediaFiles: [new File([ardourMidiBytes()], 'keys.mid')] });
	assert.ok(result);
	assert.equal(recipes[0]?.data.notes[0]?.pitch, 64);
	assert.equal(readMidiClip(result.project.clips[0])?.notes[0]?.channel, 2);
	assert.equal(result.report.items.some(item => item.disposition === 'missing'), false);
	assert.equal(fixture.state.importing, false);
});

test('MIDI activation failure and cancellation after recipe persistence remove staged sources', async () => {
	for (const cancel of [false, true]) {
		const fixture = createFixture({ createStableId: ids(), switchProject: async () => { throw new Error('activation failed'); } });
		fixture.runtime.store.writeMidiSource = async () => {
			if (cancel) fixture.projectGeneration.activate('replacement');
			return { channelCount: 1, chunkFrames: 1024 };
		};
		await assert.rejects(createNativeProjectService(fixture.runtime).openInterchange(soundcraft()), cancel ? /stale|changed|project|abort/iu : /activation failed/u);
		assert.equal(fixture.deletedSources.length, 1);
		assert.equal(fixture.state.importing, false);
	}
});

test('ambiguous MIDI companion filenames retain offline edits without inventing notes', async () => {
	const fixture = createFixture({ createStableId: ids() });
	const file = new File([ardourMidiBytes()], 'keys.mid');
	const result = await createNativeProjectService(fixture.runtime).openInterchange(new File([ardourMidiSession()], 'notes.ardour'), { mediaFiles: [file, file] });
	assert.ok(result);
	assert.equal(readMidiClip(result.project.clips[0]), null);
	const clip = result.project.clips[0]!;
	assert.ok('sourceStartFrame' in clip);
	assert.equal(clip.sourceStartFrame, 24000);
	assert.ok(result.report.items.some(item => item.disposition === 'missing'));
});
