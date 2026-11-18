/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { subprojectContentDigest } from '../src/common/editor/subprojects.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';

test('subproject commands retry a transient read of the library identity', async context => {
	const { controller, store } = await controllerSession(context);
	const original = store.settingsRepository.get.bind(store.settingsRepository);
	const key = 'soundscaper.subproject-library-id.v1';
	let failed = false;
	store.settingsRepository.get = async (name: string) => {
		if (name === key && !failed) { failed = true; throw new Error('Temporary settings read failure'); }
		return original(name);
	};

	await assert.rejects(controller.actions.subprojects.libraryId(), /Temporary settings read failure/u);

	assert.match(await controller.actions.subprojects.libraryId(), /^library-/u);
});

test('canceling Export while a subproject is being checked never opens the export destination', async context => {
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const destinations: unknown[] = [];
	const fileService = { ...createAudioEditorFileService(),
		prepareSave: async (request: unknown) => {
			destinations.push(request);
			return { mode: 'cancelled' as const, cancelled: true as const, fileName: 'Export.wav' };
		},
	};
	const { controller, store } = await controllerSession(context, { fileService: fileService as unknown as Options['fileService'] });
	const libraryId = await controller.actions.subprojects.libraryId();
	const child = createSoundscaperProject({ id: 'export-child' });
	await store.saveProject(child);
	const source = { id: 'export-proxy', kind: 'audio', name: 'Installed mix', sampleRate: 48000, channelCount: 1, frameCount: 480, storageKey: 'export-proxy' };
	const writer = await store.beginSourceWrite(source.id, { sampleRate: 48000, channelCount: 1 });
	await writer.write([new Float32Array(480).fill(0.25)]);
	await writer.commit();
	const parent = applySoundscaperProjectCommand(createSoundscaperProject({ id: 'export-parent',
		sources: [source], tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }],
		clips: [{ id: 'clip', sourceId: source.id, durationFrames: 480, sourceDurationFrames: 480 }],
	}), { type: 'subproject/install', expected: null, source, link: {
		id: 'link', projectId: child.id, libraryId, title: child.title, sourceId: source.id,
		followLatest: true, revision: child.revision, contentDigest: subprojectContentDigest(child),
		sampleRate: 48000, channelCount: 1, frameCount: 480,
	} });
	await store.saveProject(parent);
	await controller.actions.project.openById(parent.id);
	const load = store.loadProject.bind(store);
	let markCheck = (): void => undefined;
	let releaseCheck = (): void => undefined;
	const checking = new Promise<void>(resolve => { markCheck = resolve; });
	const release = new Promise<void>(resolve => { releaseCheck = resolve; });
	store.loadProject = async (id, options) => {
		if (id === child.id) { markCheck(); await release; }
		return load(id, options);
	};
	const exporting = Promise.resolve(controller.actions.export.start({ format: 'wav' }));
	const settled = Promise.allSettled([exporting]);
	await checking;
	try { await controller.actions.export.cancel(); } finally { releaseCheck(); }
	await settled;

	assert.deepEqual(destinations, []);
	assert.equal(controller.getSnapshot().exporting, false);
});
