/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { importWorkspaceRoutedFiles } from '../src/common/editor/ui/workspace/import-workspace-routed-files.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createFixture, createAudioEditorController, createMemoryEngine, ENGLISH_COPY } from './helpers/audio-editor-nyquist-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

function latch(): { ready: Promise<void>; release: () => void } {
	let release = (): void => {};
	const ready = new Promise<void>((resolve) => { release = resolve; });
	return { ready, release };
}

for (const sidecar of ['labels', 'cue'] as const) test(`Cancel during a mixed media import also stops its later ${sidecar} phase`, async () => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const fixture = await createFixture(`more200-routed-cancel-${sidecar}`, { sampleRate: 48_000, tracks: [] });
	const controller = createAudioEditorController(null, { headless: true, copy: ENGLISH_COPY, locale: 'en', store: fixture.store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	await controller.ready;
	await controller.actions.project.openById(fixture.project.id);
	const entered = latch();
	const resume = latch();
	const write = fixture.store.beginSourceWrite.bind(fixture.store);
	fixture.store.beginSourceWrite = async (...args: Parameters<typeof write>) => {
		entered.release();
		await resume.ready;
		return write(...args);
	};
	const wav = Uint8Array.from(encodeWav([new Float32Array(80).fill(.25)], { sampleRate: 48_000 }));
	const annotation = sidecar === 'labels' ? new File(['0\t1\tLater label\n'], 'later.txt')
		: new File(['FILE "Take.wav" WAVE\n TRACK 01 AUDIO\n INDEX 01 00:00:00\n'], 'later.cue');
	let cuePrompts = 0;
	const pending = importWorkspaceRoutedFiles({ controller, files: [new File([wav], 'Take.wav'), annotation],
		importOptions: {}, openProjectFile() {}, projectBinVisible: false,
		requestCueImport() { cuePrompts++; },
	});
	try {
		await entered.ready;
		assert.equal(controller.actions.project.cancelTask(), true);
		resume.release();
		await pending;
		assert.equal(controller.project?.tracks.filter(track => track.type === 'label').length, 0,
			'a cancelled mixed import must not create its later label track');
		assert.equal(cuePrompts, 0, 'Cancel must not open another import destination dialog');
		assert.equal(controller.project?.sources.length, 0);
	} finally {
		resume.release();
		await pending.catch(() => undefined);
		await controller.dispose();
	}
});
