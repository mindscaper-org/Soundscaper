/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { encodeWav } from '../src/common/editor/wav.js';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { sesxDesktopHardwareFixture } from './helpers/sesx-desktop-hardware-fixture.ts';
import { ardourExternalOriginSession } from './helpers/ardour-external-origin-fixture.ts';
import { parseArdourDocument } from '../src/common/editor/ardour-import.ts';

for (const collision of [false, true]) test(`desktop File Open retains an Ardour external source origin, internal basename collision=${String(collision)}`, async context => {
	const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
	const wave = (value: number) => Uint8Array.from(encodeWav([new Float32Array(4800).fill(value)], { sampleRate: 48000, float: true }));
	const hardware = await sesxDesktopHardwareFixture(directory => ardourExternalOriginSession(join(directory, 'Stereo.wav')), wave(.125), { fileName: 'Linked.ardour',
		extraFiles: collision ? [{ path: 'interchange/Linked session/audiofiles/Stereo.wav', bytes: wave(.375) }] : [] });
	context.after(hardware.close);
	const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine,
		fileService: hardware.fileService, scapeProjectRuntime: createSoundscaperScapeNativeRuntime() });
	try {
		const choices = await hardware.fileService.chooseFiles({ purpose: 'project', multiple: false });
		await hardware.fileService.withReadDescriptors(choices, {}, async (files: readonly File[]) => {
			assert.ok(files[0]); const opened = await controller.actions.project.openInterchange(files[0]); assert.ok(opened);
		});
		const pcm = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 4800, includeTail: false }))[0]!;
		assert.ok(Math.abs(pcm[1200]! - .125 / Math.sqrt(2)) < .00001, `linked recording must win over unused same-name media (sample: ${String(pcm[1200])})`);
		assert.equal(hardware.releasedSessions.length, 1);
	} finally { await controller.dispose(); await native.dispose(); }
});

for (const origin of ['/external/Stereo.wav', 'C:\\recordings\\Stereo.wav', '\\\\server\\recordings\\Stereo.wav']) {
	test(`Ardour linked source retains its absolute native origin ${origin}`, () => {
		assert.equal(parseArdourDocument(ardourExternalOriginSession(origin)).media[0]?.path, origin);
	});
}
for (const origin of [undefined, 'capture-original.wav']) test(`Ardour internal source keeps its session path for nonabsolute origin ${String(origin)}`, () => {
	assert.equal(parseArdourDocument(ardourExternalOriginSession(origin)).media[0]?.path, 'interchange/Linked session/audiofiles/Stereo.wav');
});
