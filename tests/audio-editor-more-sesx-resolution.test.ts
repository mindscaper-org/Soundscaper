/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { SesxMediaSessionStore } from '../desktop/sesx-media-session.mjs';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeProjectFileService, NativeSesxReadDescriptor } from '../src/common/editor/controller/document/native-project-types.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';

const SESSION = 'b'.repeat(64);

async function openSession(context: TestContext, name: string, relativePath: string) {
	const directory = await mkdtemp(join(tmpdir(), 'more-sesx-'));
	context.after(async () => { await rm(directory, { recursive: true, force: true }); });
	await mkdir(join(directory, 'Audio'));
	const xml = `<sesx><session sampleRate="48000" audioChannelType="mono"><tracks>
		<audioTrack><audioClip fileID="0" startPoint="0" endPoint="4" sourceInPoint="0" sourceOutPoint="4"/>
		</audioTrack></tracks></session><files><file id="0" relativePath="${relativePath}"/></files></sesx>`;
	const sessionPath = join(directory, 'test.sesx');
	await writeFile(sessionPath, xml);
	await writeFile(join(directory, 'Audio', name), encodeWav([new Float32Array(4).fill(0.25)], { sampleRate: 48_000 }));
	const owner = {};
	const paths = new Map<string, string>();
	let folderPrompts = 0;
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
		dialog: { showOpenDialog() { folderPrompts += 1; return Promise.resolve({ canceled: true, filePaths: [] }); } },
		windowFor: () => null,
	});
	await sessions.registerSelection(SESSION, sessionPath, { owner });
	const fixture = createFixture({
		fileService: {
			isDesktop: true,
			resolveSesxMedia: (request) => sessions.resolve({ ...request, owner }),
			chooseSesxMediaFolder: (request) => sessions.chooseFolder({ ...request, owner }),
			releaseSesxSession: (id) => Promise.resolve(sessions.release(id, { owner })),
			async withReadDescriptors<Value>(descriptors: readonly NativeSesxReadDescriptor[], _options: { signal?: AbortSignal }, consume: (blobs: readonly Blob[]) => PromiseLike<Value> | Value) {
				const blobs = await Promise.all(descriptors.map(async ({ id }) => new Blob([await readFile(paths.get(id)!)])));
				return consume(blobs);
			},
		} as NativeProjectFileService,
	});
	const file = new File([xml], 'test.sesx'); registerDesktopReadCapability(file, SESSION);
	const result = await createNativeProjectService(fixture.runtime).openSesx(file);
	return { result, folderPrompts };
}

test('MP25: SESX File Open resolves maintained audio filename aliases beside the session', async (context) => {
	const { result, folderPrompts } = await openSession(context, 'take.wave', 'Audio/take.wave');
	assert.equal(result?.project.clips.length, 1);
	assert.equal(folderPrompts, 0);
});

test('MP26: SESX File Open retains the directory of a dot-prefixed relative media path', async (context) => {
	const { result, folderPrompts } = await openSession(context, 'take.wav', './Audio/take.wav');
	assert.equal(result?.project.clips.length, 1);
	assert.equal(folderPrompts, 0);
});
