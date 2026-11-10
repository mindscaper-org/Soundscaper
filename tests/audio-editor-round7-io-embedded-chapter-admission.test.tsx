/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmbeddedChapterEncoding } from '../src/common/editor/export-embedded-chapter-encoding.ts';
import { mountedExportDialog } from './helpers/audio-editor-export-dialog-fixture.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { assertEditedAudioArchiveCustody } from './helpers/edited-audio-archive-custody.ts';
import { createReviewedAudioCodecRuntime, useLocalAudioCodecPayloads } from './helpers/reviewed-audio-codec-runtime.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { encodeWav } from '../src/common/editor/wav.js';

test('the ordinary MP3 export checkbox refuses a point label at the exclusive delivery end', async () => {
	const label = { id: 'end', title: 'End of programme', startFrame: 48_000, endFrame: 48_000 };
	assert.throws(() => createEmbeddedChapterEncoding(
		{ format: 'mp3', sampleRate: 48_000 },
		{ sampleRate: 48_000, tracks: [{ type: 'label', labels: [label] }] },
		{ embedLabelChapters: true, mode: 'mix' },
		{ startFrame: 0, endFrame: 48_000 },
	), /No labels occur in the exported range/u);
	const fixture = await mountedExportDialog({ labels: [label] });
	try {
		await fixture.chooseFormat('MP3');
		assert.equal(fixture.chapterCheckbox().getAttribute('aria-disabled'), 'true');
	} finally { await fixture.unmount(); }
});

test('the ordinary MP3 export checkbox admits an in-range point label', async () => {
	const fixture = await mountedExportDialog({ labels: [
		{ id: 'intro', title: 'Opening', startFrame: 0, endFrame: 0 },
	] });
	try {
		await fixture.chooseFormat('MP3');
		assert.notEqual(fixture.chapterCheckbox().getAttribute('aria-disabled'), 'true');
		await fixture.click(fixture.chapterCheckbox());
		await fixture.startExport();
		assert.equal(fixture.requests[0]?.embedLabelChapters, true);
	} finally { await fixture.unmount(); }
});

test('changing output to a selection without chapters clears the displayed and submitted opt-in', async () => {
	const fixture = await mountedExportDialog({ selection: { startFrame: 0, endFrame: 12_000 }, labels: [
		{ id: 'outro', title: 'Outro', startFrame: 24_000, endFrame: 24_000 },
	] });
	try {
		await fixture.chooseFormat('MP3');
		await fixture.click(fixture.chapterCheckbox());
		await fixture.chooseOutput('Current selection');
		assert.equal(fixture.chapterCheckbox().getAttribute('aria-disabled'), 'true');
		assert.equal(fixture.chapterCheckbox().getAttribute('aria-checked'), 'false');
		await fixture.startExport();
		assert.equal(fixture.requests[0]?.embedLabelChapters, undefined);
		await fixture.chooseOutput('Entire project');
		assert.notEqual(fixture.chapterCheckbox().getAttribute('aria-disabled'), 'true');
	} finally { await fixture.unmount(); }
});

test('actual imported endpoint labels remain ineligible through stored PCM, Scape and MP3 preflight', async context => {
	useLocalAudioCodecPayloads(context);
	let renderers = 0, encodes = 0;
	const codecs = createReviewedAudioCodecRuntime();
	const { controller, store } = await controllerSession(context, {
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
		engineFactory: () => { renderers++; assert.fail('An empty chapter span must be refused before rendering'); },
		ffmpeg: { ...codecs, encode: async (...args: Parameters<typeof codecs.encode>) => { encodes++; return await codecs.encode(...args); } },
	});
	const pcm = new Float32Array(48_000).fill(.25);
	await controller.actions.project.importFiles([new File([Uint8Array.from(encodeWav([pcm], { sampleRate: 48_000, float: true }))], 'Programme.wav')]);
	await controller.actions.labels.importFile(new File(['1\t1\tEnd of programme\n'], 'Programme-labels.txt', { type: 'text/plain' }));
	await controller.actions.project.flush();
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	assert.equal(project.clips[0]?.durationFrames, 48_000);
	const labels = project.tracks.flatMap(track => track.type === 'label' ? track.labels : []);
	assert.deepEqual(labels.map(label => [label.title, label.startFrame, label.endFrame]), [['End of programme', 48_000, 48_000]]);
	const reopened = await assertEditedAudioArchiveCustody(context, store, project, [pcm]);
	assert.throws(() => createEmbeddedChapterEncoding({ format: 'mp3', sampleRate: 48_000 }, reopened,
		{ mode: 'mix', embedLabelChapters: true }, { startFrame: 0, endFrame: 48_000 }), /No labels occur in the exported range/u);
	const view = await mountedExportDialog({ labels: labels.map(label => ({ ...label })) });
	try { await view.chooseFormat('MP3'); assert.equal(view.chapterCheckbox().getAttribute('aria-disabled'), 'true'); }
	finally { await view.unmount(); }
	await controller.actions.export.start({ format: 'mp3', mode: 'mix', sampleRate: 48_000, embedLabelChapters: true, includeTail: false });
	assert.equal(renderers, 0); assert.equal(encodes, 0);
	assert.match(controller.getSnapshot().status.message, /No labels occur in the exported range/u);
	assert.deepEqual(controller.project, project);
});
