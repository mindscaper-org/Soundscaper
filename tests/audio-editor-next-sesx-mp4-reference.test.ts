/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { SesxMediaSessionStore } from '../desktop/sesx-media-session.mjs';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createDawprojectAudioPreparer } from '../src/common/editor/controller/import/dawproject-audio-decode.ts';
import { DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER } from '../src/common/editor/desktop-main-audio-codec-runtime-marker.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { cloneSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import type { NativeProjectFileService, NativeSesxReadDescriptor } from '../src/common/editor/controller/document/native-project-types.ts';
import { aacLcM4a48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const [extension, relocated] of [['m4a', false], ['mp4', false], ['mp4', true]] as const) {
	test(`desktop SESX File Open resolves its ${relocated ? 'relocated' : 'adjacent'} AAC .${extension} recording`, async context => {
		const directory = await mkdtemp(join(tmpdir(), 'next-sesx-mp4-'));
		context.after(() => rm(directory, { recursive: true, force: true }));
		const sessionFolder = join(directory, 'session'), mediaFolder = join(directory, 'media');
		await mkdir(sessionFolder); await mkdir(mediaFolder);
		const name = `Recording.${extension}`, referencePath = `Audio/${name}`;
		const destination = relocated ? mediaFolder : join(sessionFolder, 'Audio');
		if (!relocated) await mkdir(destination);
		const bytes = aacLcM4a48_000Fixture(), mediaPath = join(destination, name);
		await writeFile(mediaPath, bytes);
		const xml = `<sesx><session sampleRate="48000" audioChannelType="stereo"><tracks>
			<audioTrack><audioClip fileID="0" startPoint="0" endPoint="2400" sourceInPoint="0" sourceOutPoint="2400"/>
			</audioTrack></tracks></session><files><file id="0" relativePath="${referencePath}"/></files></sesx>`;
		const sessionPath = join(sessionFolder, 'Session.sesx'); await writeFile(sessionPath, xml);
		const owner = {}, capability = 'a'.repeat(64);
		const paths = new Map<string, string>(), granted: NativeSesxReadDescriptor[] = [];
		let prompts = 0, utilityCalls = 0, writtenFrames = 0;
		const sessions = new SesxMediaSessionStore({
			readCapabilities: {
				async resolveHelperGrant() {
					const details = await stat(sessionPath);
					return { path: sessionPath, size: details.size, identity: { dev: details.dev, ino: details.ino } };
				},
				async registerSelectedRangePath(path: string) {
					const id = String(paths.size), details = await stat(path); paths.set(id, path);
					const descriptor: NativeSesxReadDescriptor = { id, name: basename(path), readProfile: 'linked-audio-range-v1',
						size: details.size, lastModified: details.mtimeMs, mimeType: 'audio/mp4', url: `soundscaper-app://media/${id}` };
					granted.push(descriptor); return descriptor;
				},
			},
			dialog: { showOpenDialog() { prompts++; return Promise.resolve({ canceled: !relocated, filePaths: relocated ? [mediaFolder] : [] }); } },
			windowFor: () => null,
		});
		context.after(() => { sessions.dispose(); });
		await sessions.registerSelection(capability, sessionPath, { owner });
		let ordinal = 0;
		const codec = { [DESKTOP_MAIN_AUDIO_CODEC_RUNTIME_MARKER]: true as const,
			async decode(file: Blob, options: Readonly<Record<string, unknown>>) {
				assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
				assert.equal(options.format, 'aac-m4a'); utilityCalls++;
				return { sampleRate: 48_000, channels: [new Float32Array(3072).fill(.25), new Float32Array(3072).fill(-.25)] };
			},
		};
		const fixture = createFixture({ createStableId: prefix => `${prefix}-${++ordinal}`,
			adaptAudacityProject: importSoundscaperAudacityProject, prepareDawprojectAudio: createDawprojectAudioPreparer(codec),
			store: { estimateStorage: async () => ({ usage: 0, quota: 1e9 }), beginSourceWrite: async () => ({
				write: async channels => { assert.ok(channels[0]); writtenFrames += channels[0].length; },
				commit: async () => undefined, abort: async () => undefined,
			}), deleteSource: async () => undefined },
		});
		const fileService = { ...fixture.runtime.fileService, isDesktop: true,
			async resolveSesxMedia(request: { sessionReadId: string; relativePath: string; mediaRootId?: string }) {
				const result: unknown = await sessions.resolve({ ...request, owner });
				assert.ok(result && typeof result === 'object' && 'status' in result);
				if (result.status === 'found') { const descriptor = granted.at(-1); assert.ok(descriptor); return { status: 'found' as const, descriptor }; }
				if (result.status === 'missing' || result.status === 'ambiguous' || result.status === 'scan-limited') return { status: result.status };
				throw new Error('Unexpected media resolver result');
			},
			chooseSesxMediaFolder: (request: { sessionReadId: string }) => sessions.chooseFolder({ ...request, owner }),
			releaseSesxSession: (id: string) => Promise.resolve(sessions.release(id, { owner })),
			async withReadDescriptors<Value>(descriptors: readonly NativeSesxReadDescriptor[], _options: { signal?: AbortSignal }, consume: (blobs: readonly Blob[]) => PromiseLike<Value> | Value) {
				const blobs = await Promise.all(descriptors.map(async ({ id }) => { const path = paths.get(id); assert.ok(path);
					return new Blob([Uint8Array.from(await readFile(path))], { type: 'audio/mp4' }); }));
				return consume(blobs);
			},
		} satisfies NativeProjectFileService;
		const file = new File([xml], 'Session.sesx'); registerDesktopReadCapability(file, capability);
		const opened = await createNativeProjectService({ ...fixture.runtime, fileService }).openSesx(file);
		assert.ok(opened);
		const project = cloneSoundscaperProject(opened.project);
		assert.equal(project.clips.length, 1, 'an existing AAC recording must not be reported missing because it uses the .mp4 extension');
		assert.equal(project.sources.length, 1); assert.equal(project.sources[0]?.frameCount, 2400);
		assert.equal(utilityCalls, 1); assert.equal(writtenFrames, 2400);
		assert.equal(prompts, relocated ? 1 : 0); assert.deepEqual([...paths.values()], [mediaPath]);
	});
}
