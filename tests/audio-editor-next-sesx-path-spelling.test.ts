/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { SesxMediaSessionStore } from '../desktop/sesx-media-session.mjs';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeProjectFileService, NativeSesxReadDescriptor } from '../src/common/editor/controller/document/native-project-types.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

test('SESX File Open preserves the exact leading space of its media directory', async context => {
	const directory = await mkdtemp(join(tmpdir(), 'next-sesx-spelling-'));
	context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	const relativePath = ' Audio/take.wav';
	const mediaPath = join(directory, relativePath);
	await mkdir(dirname(mediaPath));
	await writeFile(mediaPath, encodeWav([new Float32Array(4).fill(.25)], { sampleRate: 48_000 }));
	const xml = `<sesx><session sampleRate="48000" audioChannelType="mono"><tracks>
		<audioTrack><audioClip fileID="0" startPoint="0" endPoint="4" sourceInPoint="0" sourceOutPoint="4"/>
		</audioTrack></tracks></session><files><file id="0" relativePath="${relativePath}"/></files></sesx>`;
	const sessionPath = join(directory, 'test.sesx');
	await writeFile(sessionPath, xml);
	const owner = {};
	const capability = 'a'.repeat(64);
	const paths = new Map<string, string>();
	let prompts = 0;
	const sessions = new SesxMediaSessionStore({
		readCapabilities: {
			async resolveHelperGrant() {
				const details = await stat(sessionPath);
				return { path: sessionPath, size: details.size, identity: { dev: details.dev, ino: details.ino } };
			},
			registerSelectedRangePath(path: string) {
				const id = String(paths.size); paths.set(id, path);
				return Promise.resolve({ id, name: basename(path), readProfile: 'linked-audio-range-v1' });
			},
		},
		dialog: { showOpenDialog() { prompts += 1; return Promise.resolve({ canceled: true, filePaths: [] }); } },
		windowFor: () => null,
	});
	await sessions.registerSelection(capability, sessionPath, { owner });
	const fixture = createFixture({ fileService: {
		isDesktop: true,
		resolveSesxMedia: request => sessions.resolve({ ...request, owner }),
		chooseSesxMediaFolder: request => sessions.chooseFolder({ ...request, owner }),
		releaseSesxSession: id => Promise.resolve(sessions.release(id, { owner })),
		async withReadDescriptors<Value>(descriptors: readonly NativeSesxReadDescriptor[], _options: { signal?: AbortSignal }, consume: (blobs: readonly Blob[]) => PromiseLike<Value> | Value) {
			const blobs = await Promise.all(descriptors.map(async ({ id }) => {
				const path = paths.get(id); assert.ok(path);
				return new Blob([await readFile(path)]);
			}));
			return consume(blobs);
		},
	} as NativeProjectFileService });
	const file = new File([xml], 'test.sesx'); registerDesktopReadCapability(file, capability);
	const result = await createNativeProjectService(fixture.runtime).openSesx(file);
	assert.equal(result?.project.clips.length, 1);
	assert.equal(prompts, 0, 'the exact adjacent media path must resolve without a replacement folder');
	assert.deepEqual([...paths.values()], [mediaPath]);
});
