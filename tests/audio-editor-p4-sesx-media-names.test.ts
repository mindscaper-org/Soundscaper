/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPcmSamplesEqual } from './helpers/assert-pcm-samples.ts';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeProjectFileService } from '../src/common/editor/controller/document/native-project-types.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { escapeXml } from '../src/common/editor/dawproject-xml.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const name of ['  Dialogue take  ', '\n\tDialogue\n', 'Ordinary name', '   ']) {
	test(`desktop File Open SESX preserves authored media names ${JSON.stringify(name)}`, async () => {
		const samples = new Float32Array(480).fill(.25);
		const audio = new Blob([Uint8Array.from(encodeWav([samples], { sampleRate: 48_000, float: true }))]);
		const attributeName = escapeXml(name).replaceAll('\n', '&#10;').replaceAll('\t', '&#9;');
		const file = new File([`<sesx><session sampleRate="48000" audioChannelType="mono"><tracks>
		<audioTrack><trackParameters><name>${escapeXml(name)}</name></trackParameters>
		<audioClip fileID="0" name="${attributeName}" startPoint="0" endPoint="480" sourceInPoint="0" sourceOutPoint="480"/>
		</audioTrack></tracks></session><files><file id="0" relativePath="Voice.wav"/></files></sesx>`], 'Session.sesx');
		registerDesktopReadCapability(file, 'a'.repeat(64));
		let written = new Float32Array(); let released = 0; let nextId = 0;
		const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject,
			createStableId: prefix => `${prefix}-${String(++nextId)}`,
			store: { estimateStorage: async () => ({ usage: 0, quota: 1e9 }), beginSourceWrite: async () => ({
				write: async channels => { const channel = channels[0]; assert.ok(channel); written = channel.slice(); },
				commit: async () => undefined, abort: async () => undefined,
			}), deleteSource: async () => undefined },
		});
		const fileService = { ...fixture.runtime.fileService, isDesktop: true,
			resolveSesxMedia: async () => ({ status: 'found', descriptor: { id: 'read', name: 'Voice.wav', size: audio.size,
				lastModified: 0, mimeType: 'audio/wav', readProfile: 'linked-audio-range-v1', url: 'soundscaper-app://media/voice' } }),
			chooseSesxMediaFolder: async () => ({ status: 'cancelled' }),
			withReadDescriptors: async (_descriptors, _options, consume) => await consume([audio]),
			releaseSesxSession: async () => { released++; return true; },
		} satisfies NativeProjectFileService;
		const opened = await createNativeProjectService({ ...fixture.runtime, fileService }).openSesx(file);
		assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project));
		const track = opened.project.tracks[0]; assert.ok(track);
		const clip = opened.project.clips[0]; assert.ok(clip);
		assert.deepEqual([track.name, clip.title], [name.trim() ? name : 'Track 1', name.trim() ? name : 'Track 1']);
		assertPcmSamplesEqual(written, samples);
		assert.equal(released, 1); assert.deepEqual(fixture.switched, [opened.project.id]);
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
		try {
			await store.saveProject(opened.project);
			const saved: unknown = await store.loadProject(opened.project.id);
			assert.ok(validateSoundscaperProject(saved));
			assert.deepEqual([saved.tracks[0]?.name, saved.clips[0]?.title], [track.name, clip.title]);
		} finally { await store.close(); }
	});
}
