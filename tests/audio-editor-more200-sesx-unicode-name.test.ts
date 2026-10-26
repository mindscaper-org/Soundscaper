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

for (const [reference, actual] of [['Café.wav', 'Cafe\u0301.wav'], ['Cafe\u0301.wav', 'Café.wav']]) {
	test(`SESX File Open locates canonically equivalent relocated media ${JSON.stringify(actual)}`, async context => {
		const result = await open(context, reference!, [actual!]);
		assert.equal(result.project.clips.length, 1, 'the selected healthy recording must not be reported missing');
		assert.equal(result.writtenFrames, 4);
		assert.equal(result.granted.length, 1);
	});
}

test('SESX normalized basename collisions remain ambiguous', async context => {
	const result = await open(context, 'Café.wav', ['Café.wav', 'Cafe\u0301.wav']);
	assert.equal(result.project.clips.length, 0);
	assert.equal(result.granted.length, 0);
});

test('SESX an exact relocated path wins before normalized basename ambiguity', async context => {
	const result = await open(context, 'Café.wav', ['Café.wav', 'Cafe\u0301.wav'], true);
	assert.equal(result.project.clips.length, 1);
	assert.equal(result.granted.length, 1);
	assert.equal(result.granted[0]?.name, 'Café.wav');
});

async function open(context: TestContext, reference: string, names: readonly string[], exact = false) {
	const root = await mkdtemp(join(tmpdir(), 'more200-sesx-unicode-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const mediaRoot = join(root, 'Relocated'); await mkdir(mediaRoot);
	for (const [index, name] of names.entries()) {
		const directory = join(mediaRoot, String(index)); await mkdir(directory);
		await writeFile(join(directory, name), encodeWav([new Float32Array(4).fill(.25)], { sampleRate: 48_000 }));
	}
	const relative = `${exact ? '0' : 'Old'}/${reference}`;
	const xml = `<sesx><session sampleRate="48000" audioChannelType="mono"><tracks><audioTrack>
		<audioClip fileID="0" startPoint="0" endPoint="4" sourceInPoint="0" sourceOutPoint="4"/>
		</audioTrack></tracks></session><files><file id="0" relativePath="${relative}"/></files></sesx>`;
	const sessionPath = join(root, 'Session.sesx'); await writeFile(sessionPath, xml);
	const owner = {}, sessionReadId = 'a'.repeat(64), paths = new Map<string, string>();
	const granted: NativeSesxReadDescriptor[] = [];
	const sessions = new SesxMediaSessionStore({
		readCapabilities: {
			async resolveHelperGrant() {
				const details = await stat(sessionPath);
				return { path: sessionPath, size: details.size, identity: { dev: details.dev, ino: details.ino } };
			},
			async registerSelectedRangePath(path: string) {
				const id = String(paths.size), details = await stat(path); paths.set(id, path);
				const descriptor: NativeSesxReadDescriptor = { id, name: basename(path), size: details.size,
					mimeType: 'audio/wav', readProfile: 'linked-audio-range-v1', lastModified: details.mtimeMs,
					url: `soundscaper-app://media/${id}` };
				granted.push(descriptor); return descriptor;
			},
		},
		dialog: { showOpenDialog: () => Promise.resolve({ canceled: false, filePaths: [mediaRoot] }) },
		windowFor: () => null,
	});
	context.after(() => { sessions.dispose(); });
	await sessions.registerSelection(sessionReadId, sessionPath, { owner });
	let writtenFrames = 0;
	const fixture = createFixture({ store: { estimateStorage: async () => ({ usage: 0, quota: 1e9 }),
		beginSourceWrite: async () => ({ write: async channels => { writtenFrames += channels[0]?.length ?? 0; },
			commit: async () => undefined, abort: async () => undefined }), deleteSource: async () => undefined } });
	const fileService = { ...fixture.runtime.fileService, isDesktop: true,
		async resolveSesxMedia(request: { sessionReadId: string; relativePath: string; mediaRootId?: string }) {
			const result: unknown = await sessions.resolve({ ...request, owner });
			assert.ok(result && typeof result === 'object' && 'status' in result);
			if (result.status === 'found') { const descriptor = granted.at(-1); assert.ok(descriptor); return { status: 'found' as const, descriptor }; }
			if (result.status === 'missing' || result.status === 'ambiguous' || result.status === 'scan-limited') return { status: result.status };
			throw new Error('Unexpected SESX resolver status.');
		},
		chooseSesxMediaFolder: (request: { sessionReadId: string }) => sessions.chooseFolder({ ...request, owner }),
		releaseSesxSession: (id: string) => Promise.resolve(sessions.release(id, { owner })),
		async withReadDescriptors<Value>(descriptors: readonly NativeSesxReadDescriptor[], _options: { signal?: AbortSignal }, consume: (files: readonly Blob[]) => PromiseLike<Value> | Value) {
			return consume(await Promise.all(descriptors.map(async ({ id }) => {
				const path = paths.get(id); assert.ok(path); return new Blob([Uint8Array.from(await readFile(path))]);
			})));
		},
	} satisfies NativeProjectFileService;
	const file = new File([xml], 'Session.sesx'); registerDesktopReadCapability(file, sessionReadId);
	const result = await createNativeProjectService({ ...fixture.runtime, fileService }).openSesx(file);
	assert.ok(result); return { project: result.project, granted, writtenFrames };
}
