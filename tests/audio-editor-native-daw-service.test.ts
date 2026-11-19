/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { ardourSession, soundcraftSession } from './helpers/native-daw-import-fixtures.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { acceptsFile, mimeTypeForPath } from '../desktop/validation.js';

function ids() { let next = 0; return (prefix: string) => `${prefix}-${++next}`; }
function audio(): File {
	return new File([encodeWav([new Float32Array(48000).fill(0.25)], { sampleRate: 48000, float: true }) as Uint8Array<ArrayBuffer>], 'voice.wav');
}
async function session(extension: string): Promise<File> {
	if (extension === 'ardour') return new File([ardourSession(true)], 'voice.ardour');
	const text = JSON.stringify(soundcraftSession());
	if (extension === 'scraft') return new File([text], 'voice.scraft');
	const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
	await writer.add('voice.scraft', new TextReader(text));
	await writer.add('Audio Files/voice.wav', new BlobReader(audio()));
	return new File([await writer.close()], 'voice.scraftz');
}

for (const extension of ['ardour', 'scraft', 'scraftz']) {
	test(`${extension} imports PCM before activation and is admitted by desktop Open and Import`, async () => {
		assert.ok(acceptsFile('project', `/session/voice.${extension}`));
		assert.ok(acceptsFile('media', `/session/voice.${extension}`));
		assert.equal(acceptsFile('audio-video', `/session/voice.${extension}`), false);
		assert.notEqual(mimeTypeForPath(`/session/voice.${extension}`), 'application/octet-stream');
		let frames = 0, committed = false;
		const fixture = createFixture({ createStableId: ids() });
		fixture.runtime.store.beginSourceWrite = async () => ({
			write: async channels => { frames += channels[0]!.length; assert.equal(channels[0]![0], 0.25); },
			commit: async () => { committed = true; }, abort: async () => undefined,
		});
		const result = await createNativeProjectService(fixture.runtime).openInterchange(await session(extension), { mediaFiles: extension === 'scraftz' ? [] : [audio()] });
		assert.ok(result);
		assert.equal(frames, 48000); assert.equal(committed, true);
		assert.equal(result.project.clips.length, 1);
		const clip = result.project.clips[0]!;
		assert.ok('sourceStartFrame' in clip && 'durationFrames' in clip);
		assert.equal(clip.sourceStartFrame, 12000);
		assert.equal(clip.durationFrames, 24000);
		assert.equal(result.report.items.some(item => item.disposition === 'missing'), false);
		assert.doesNotThrow(() => validateCurrentAudioEditorProject(result.project));
		assert.equal(fixture.state.importing, false);
	});

	test(`${extension} failed activation removes staged audio and finishes import`, async () => {
		const deleted: string[] = [];
		const fixture = createFixture({ createStableId: ids(), switchProject: async () => { throw new Error('activation failed'); } });
		fixture.runtime.store.deleteSource = async id => { deleted.push(id); };
		await assert.rejects(createNativeProjectService(fixture.runtime).openInterchange(await session(extension), { mediaFiles: [audio()] }), /activation failed/u);
		assert.equal(deleted.length, 1); assert.equal(fixture.state.importing, false);
	});
}
