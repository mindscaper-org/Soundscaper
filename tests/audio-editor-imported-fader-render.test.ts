/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { convertLegacyAupToProject } from '../src/common/editor/aup-legacy-conversion.js';
import { decodeAudacityBinaryXml } from '../src/common/editor/audacity-binary-xml.js';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { createAup4SampleBlock } from '../src/common/editor/aup4-profile.js';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createAup3ProjectData } from './aup3-fixture.js';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';

const RATE = 48_000, FRAMES = 4800;

// The complete scalar matrix belongs here. Browser specs retain high-gain
// File Import/Open, native WAV download, reload, and nonlinear-rack refusal.
for (const format of ['legacy-aup', 'aup3'] as const) for (const gain of [8, 10 ** (36 / 20), 4]) {
	test(`${format} fader ${gain} renders its original level before and after independent Scape reopen`, async context => {
		const samples = new Float32Array(FRAMES).fill(.002);
		const decoded = format === 'legacy-aup'
			? convertLegacyAupToProject({ sampleRate: RATE, tracks: [{ type: 'audio', name: 'Voice',
				rate: RATE, gain, clips: [{ channels: [samples], startSeconds: 0 }] }] })
			: await modernProject(gain, samples);
		const project = importSoundscaperAudacityProject(decoded.project);
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
		const recipient = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `${context.name}:reopened` });
		const native = createNodeWebAudioEngineFactory(context);
		try {
			assert.equal(project.sources.length, 1);
			const source = project.sources[0]; assert.ok(source?.kind === 'audio');
			const writer = await store.beginSourceWrite(source.storageKey, source);
			const original = decoded.sources.find(row => row.sourceId === source.id); assert.ok(original);
			assertPcmChannelsEqual(original.channels, [samples], 'decoder PCM');
			await writer.write(original.channels); await writer.commit();
			await assertProgramme(project, store);
			const archive = createSoundscaperScapeNativeRuntime();
			const saved = await archive.exportScapeProject(project, store); assert.ok(saved.blob);
			const imported = await archive.importScapeProject(saved.blob, recipient);
			assert.equal(imported.readOnly, false);
			const reopened: unknown = imported.project; assert.ok(validateSoundscaperProject(reopened));
			assert.deepEqual(reopened, project);
			await assertProgramme(reopened, recipient);
		} finally { await store.close(); await recipient.close(); await native.dispose(); }

		async function assertProgramme(value: typeof project, repository: typeof store): Promise<void> {
			const track = value.tracks.find(row => row.type === 'audio'); assert.ok(track);
			const clip = value.clips[0]; assert.ok(clip?.kind === 'audio');
			assert.equal(track.gain * clip.gain, gain);
			const source = value.sources[0]; assert.ok(source?.kind === 'audio');
			assertPcmChannelsEqual(await readCustodyPcm(repository, source), [samples], 'retained source PCM');
			const renderer = native.createEngine();
			try {
				const buffer = await repository.loadSourceAudioBuffer(source.storageKey, await renderer.getAudioContext({ resume: false }));
				assert.ok(buffer instanceof AudioBuffer);
				renderer.loadProject(projectForRuntimeConsumers(value), new Map([[source.id, buffer]]));
				const output = await renderer.renderMix({ startFrame: 0, endFrame: FRAMES });
				assert.ok(output instanceof AudioBuffer);
				assert.deepEqual([output.sampleRate, output.length, output.numberOfChannels], [RATE, FRAMES, 2]);
				const expected = Math.fround(.002) * gain * Math.SQRT1_2;
				for (let channel = 0; channel < 2; channel++) for (let frame = 256; frame < FRAMES - 256; frame++) {
					assert.ok(Math.abs(output.getChannelData(channel)[frame]! - expected) < 1e-7,
						`channel ${channel}, frame ${frame}: expected ${expected}`);
				}
			} finally { await renderer.dispose(); }
		}
	});
}

async function modernProject(gain: number, samples: Float32Array) {
	const fixture = createAup3ProjectData({ sampleRate: RATE, tracks: [{ name: 'Voice', gain,
		clips: [{ samples: Array.from(samples) }] }] });
	const root = decodeAudacityBinaryXml(fixture.dictionary, fixture.document).root;
	return await decodeAudacityProjectTree(root, () => createAup4SampleBlock(samples), { sourceGeneration: 'aup3' });
}
