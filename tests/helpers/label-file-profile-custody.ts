/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createAudioEditorFileService } from '../../src/common/editor/file-service.js';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import type { SoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { importWorkspaceRoutedFiles } from '../../src/common/editor/ui/workspace/import-workspace-routed-files.ts';
import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import { controllerSession } from './soundscaper-controller-session.ts';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';

export function labelFileProject(value: unknown): SoundscaperProject {
	assert.ok(validateSoundscaperProject(value)); return value;
}

export function labelFilePoints(project: SoundscaperProject) {
	return project.tracks.flatMap(track => {
		if (track.type !== 'label') return [];
		assert.ok(Array.isArray(track.labels));
		return track.labels.map((value: unknown) => {
			assert.ok(value && typeof value === 'object');
			const title: unknown = Reflect.get(value, 'title'), startFrame: unknown = Reflect.get(value, 'startFrame'), endFrame: unknown = Reflect.get(value, 'endFrame');
			assert.ok(typeof title === 'string' && typeof startFrame === 'number' && typeof endFrame === 'number');
			return { title, startFrame, endFrame };
		});
	});
}

/** Actual shared routing, label controller/file service, product repositories and independent native Scape. */
export async function labelFileProfileCustody(context: TestContext) {
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const saved: File[] = [];
	const options = { copy: ENGLISH_COPY, scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		ffmpeg: { ...createMemoryFfmpeg(), decode: () => assert.fail('Label files cannot substitute decoded audio'),
			encode: () => assert.fail('Label files cannot substitute encoded audio') } as unknown as Options['ffmpeg'],
		engineFactory: () => assert.fail('Label files cannot render substitute PCM'),
		fileService: { ...createAudioEditorFileService(), async saveFile(request: unknown) {
			assert.ok(request && typeof request === 'object'); assert.equal(Reflect.get(request, 'purpose'), 'labels');
			const blob: unknown = Reflect.get(request, 'blob'), name: unknown = Reflect.get(request, 'suggestedName');
			assert.ok(blob instanceof Blob && typeof name === 'string');
			saved.push(new File([blob], name, { type: blob.type })); return { method: 'node-fixture', fileName: name, size: blob.size };
		} } };
	const sender = await controllerSession(context, options);
	return { ...sender, saved, async import(file: File) {
		assert.equal(await importWorkspaceRoutedFiles({ controller: sender.controller, files: [file], importOptions: {}, projectBinVisible: false,
			openProjectFile: () => assert.fail('A label file must not open a project'), requestCueImport: () => assert.fail('These label files contain no CUE sheet'),
		}), 1);
	}, async reopen() {
		await sender.controller.actions.project.flush();
		const project = labelFileProject(sender.controller.project); assert.equal(project.sources.length, 0);
		assert.deepEqual(await sender.store.loadProject(project.id), project);
		const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, sender.store); assert.ok(archive.blob);
		const recipient = await controllerSession(context, options);
		await recipient.controller.actions.project.openScapeFile(new File([archive.blob], 'Labels.sscape'), () => 'copy');
		const restored = labelFileProject(recipient.controller.project);
		assert.deepEqual(restored, project, 'complete label document survives independent native Scape');
		assert.deepEqual(await recipient.store.loadProject(project.id), project, 'complete label document reaches the fresh product repository');
		return { ...recipient, project: restored };
	} };
}
