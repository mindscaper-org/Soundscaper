/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { acceptsFile, validateFileChoice, validateSaveChoice } from '../desktop/validation.js';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { openDesktopWorkspaceFiles } from '../src/common/editor/ui/workspace/desktop-workspace-file-choice.ts';
import { importWorkspaceRoutedFiles } from '../src/common/editor/ui/workspace/import-workspace-routed-files.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture } from './helpers/native-project-service-fixture.ts';
import { sesxDesktopHardwareFixture } from './helpers/sesx-desktop-hardware-fixture.ts';

test('desktop Open and Import admit ADLs and package pickers without treating them as audio streams', () => {
	for (const purpose of ['project', 'media']) {
		assert.equal(acceptsFile(purpose, '/sessions/voice.ADL'), true);
		assert.equal(acceptsFile(purpose, '/sessions/voice.adl.zip'), true);
		assert.equal(acceptsFile(purpose, '/sessions/unrelated.zip'), false);
		assert.ok(validateFileChoice({ purpose }).extensions.includes('adl'));
	}
	assert.equal(acceptsFile('audio-video', '/sessions/voice.adl'), false);
	assert.equal(acceptsFile('audio-video', '/sessions/voice.adl.zip'), false);
	const choice = validateSaveChoice({ purpose: 'interchange', suggestedName: 'voice.adl.zip' });
	assert.equal(choice.suggestedName, 'voice.adl.zip');
	assert.ok(choice.filters[0]!.extensions.includes('zip'));
});

test('superseded desktop batch imports retire unread sessions so another import can resolve media', async context => {
	const text = readFileSync(new URL('./fixtures/aes31/voice.adl', import.meta.url), 'utf8')
		.replace('URL:file://localhost/Audio/voice.wav', 'URL:Stereo.wav');
	const wave = new Uint8Array(encodeWav([new Float32Array(96_000).fill(.125), new Float32Array(96_000).fill(.5)],
		{ sampleRate: 48_000, float: true }));
	let supersede: (() => void) | undefined;
	const hardware = await sesxDesktopHardwareFixture(text, wave, {
		fileName: 'First.adl', additionalSelectedFiles: ['Second.adl'],
		extraFiles: [{ path: 'Second.adl', bytes: new TextEncoder().encode(text) }],
		onRangeRead(request) {
			if (new URL(request.url).pathname.endsWith('/Stereo.wav')) supersede?.();
		},
	});
	context.after(hardware.close);
	let id = 0;
	const fixture = createFixture({ fileService: hardware.fileService, createStableId: prefix => `${prefix}-${++id}` });
	const { openInterchange } = createNativeProjectService(fixture.runtime);
	let writtenFrames = 0;
	fixture.runtime.store.beginSourceWrite = async () => ({
		async write(channels) {
			assert.equal(channels.length, 1);
			assert.ok(channels[0]!.every(sample => sample === .5));
			writtenFrames += channels[0]!.length;
		},
		async commit() {}, async abort() {},
	});
	const runImport = (multiple: boolean) => openDesktopWorkspaceFiles({
		getProjectId: () => fixture.runtime.getProject()?.id ?? null,
		fileService: hardware.fileService,
		importFiles: (files, importOptions) => importWorkspaceRoutedFiles({
			controller: {
				get project() { return fixture.runtime.getProject(); },
				actions: { project: { openInterchange, importFiles: () => assert.fail('No loose media was selected') },
					labels: { importFile: () => assert.fail('No labels were selected') } },
			},
			files, importOptions, projectBinVisible: false,
			openProjectFile: () => assert.fail('ADL uses the interchange route'),
			requestCueImport: () => assert.fail('No cue was selected'),
		}),
	}, 'media', multiple);

	for (let attempt = 0; attempt < 4; attempt++) {
		supersede = () => { supersede = undefined; fixture.replaceProject(`other-${attempt}`); };
		await assert.rejects(runImport(true), { code: 'PROJECT_CHANGED' }, `batch ${attempt + 1} reaches the project switch`);
		assert.equal(fixture.runtime.getProject()?.id, `other-${attempt}`);
	}
	assert.equal(writtenFrames, 0);
	assert.equal(await runImport(false), 1);
	assert.equal(writtenFrames, 96_000);
	assert.equal(fixture.runtime.getProject()?.title, 'Dialogue & atmosphere');
	assert.ok(hardware.requests.some(request => request.url.endsWith('/Stereo.wav') && request.status === 206));
	assert.ok(hardware.requests.every(request => !request.url.endsWith('/Second.adl')));
});
