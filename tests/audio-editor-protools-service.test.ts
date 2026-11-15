/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { proToolsFixture } from './helpers/protools-import-fixture.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { acceptsFile, validateFileChoice } from '../desktop/validation.js';

function ids() { let next = 0; return (prefix: string) => `${prefix}-${++next}`; }
function session(extension: string): File {
	return new File([proToolsFixture({ version: extension === 'pts' ? 5 : extension === 'ptf' ? 8 : 12 })], `Voice.${extension}`);
}
function audio(): File {
	return new File([encodeWav([new Float32Array(48000).fill(0.25)], { sampleRate: 48000, float: true }) as Uint8Array<ArrayBuffer>], 'voice.wav');
}

for (const extension of ['ptx', 'ptf', 'pts']) {
	test(`${extension} opens offline audio edits and appears in desktop Open and Import choosers`, async () => {
		for (const purpose of ['project', 'media'] as const) {
			assert.ok(acceptsFile(purpose, `/session/Voice.${extension}`));
			assert.ok(validateFileChoice({ purpose }).extensions.includes(extension));
		}
		assert.equal(acceptsFile('audio-video', `/session/Voice.${extension}`), false);
		const fixture = createFixture({ createStableId: ids() });
		const result = await createNativeProjectService(fixture.runtime).openInterchange(session(extension));
		assert.ok(result);
		assert.equal(result.project.title, 'Voice');
		assert.equal(result.project.clips.length, 1);
		assert.ok(result.report.items.some(item => item.code === 'protools.media-missing'));
		assert.doesNotThrow(() => validateCurrentAudioEditorProject(result.project));
		assert.equal(fixture.state.importing, false);
	});

	test(`${extension} imports selected companion PCM with source trims before activating`, async () => {
		let frames = 0, committed = false;
		const fixture = createFixture({ createStableId: ids() });
		fixture.runtime.store.beginSourceWrite = async () => ({
			write: async channels => { frames += channels[0]!.length; assert.equal(channels[0]![0], 0.25); },
			commit: async () => { committed = true; }, abort: async () => undefined,
		});
		const result = await createNativeProjectService(fixture.runtime).openInterchange(session(extension), { mediaFiles: [audio()] });
		assert.ok(result); assert.equal(frames, 48000); assert.equal(committed, true);
		const clip = result.project.clips[0]!;
		assert.ok('sourceStartFrame' in clip && 'durationFrames' in clip && 'timelineStartFrame' in clip);
		assert.equal(clip.sourceStartFrame, 12000); assert.equal(clip.durationFrames, 24000); assert.equal(clip.timelineStartFrame, 24000);
		assert.equal(result.report.items.some(item => item.disposition === 'missing'), false);
	});
}

test('a failed Pro Tools activation rolls back newly staged media', async () => {
	const deleted: string[] = [];
	const fixture = createFixture({ createStableId: ids(), switchProject: async () => { throw new Error('activation failed'); } });
	fixture.runtime.store.deleteSource = async id => { deleted.push(id); };
	await assert.rejects(createNativeProjectService(fixture.runtime).openInterchange(session('ptx'), { mediaFiles: [audio()] }), /activation failed/u);
	assert.equal(deleted.length, 1); assert.equal(fixture.state.importing, false);
});

test('malformed Pro Tools bytes leave the current document and media untouched', async () => {
	let writes = 0;
	const fixture = createFixture({ createStableId: ids() });
	fixture.runtime.store.beginSourceWrite = async () => { writes++; throw new Error('unexpected write'); };
	const before = fixture.runtime.getProject();
	await assert.rejects(createNativeProjectService(fixture.runtime).openInterchange(new File(['invalid'], 'bad.ptx'), { mediaFiles: [audio()] }), /header/iu);
	assert.equal(writes, 0); assert.equal(fixture.runtime.getProject(), before); assert.equal(fixture.state.importing, false);
});
