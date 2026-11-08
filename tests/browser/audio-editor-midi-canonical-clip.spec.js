/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { createAudioClip, createAudioSource } from '../../src/common/editor/project-media-factory.ts';
import { createMidiTrack } from '../../src/common/editor/midi-factory.ts';
import { readMidiClip, withMidiClipData } from '../../src/common/editor/midi-model.ts';
import { renderMidiFrames } from '../../src/common/editor/engine/midi-synthesis.ts';
import { resolveRuntimeClipProjection } from '../../src/common/editor/runtime-clip-projection.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const musical of [false, true]) test(`reopened ${musical ? 'musical' : 'sample'} MIDI project supports piano-strip trim and history`, async ({ page }) => {
	const tempoMap = { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] };
	const source = createAudioSource({ id: 'source', name: 'Notes', storageKey: `midi-pcm-${musical}`, sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const notes = [{ id: 'note', pitch: 69, startFrame: 12_000, durationFrames: 24_000, velocity: 100, channel: 0 }];
	const clip = withMidiClipData(createAudioClip({ id: 'clip', title: 'Notes', sourceId: source.id, sourceStartFrame: 0, sourceDurationFrames: 48_000,
		...(musical ? { anchor: 'musical', musicalStartBeat: 2, musicalExtent: 'beat', musicalDurationBeats: 2 }
			: { timelineStartFrame: 48_000, durationFrames: 48_000 }),
	}, { projectSampleRate: 48_000, tempoMap }), { version: 1, notes });
	const track = createMidiTrack({ id: 'track', name: 'Notes', clipIds: [clip.id], instrument: 'sine' });
	const project = createSoundscaperProject({ id: `canonical-midi-resize-${musical}`, sampleRate: 48_000, tempoMap, sources: [source], clips: [clip], tracks: [track] });
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	let archive;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([renderMidiFrames(notes, 'sine', 48_000, 0, 48_000)]); await writer.commit();
		archive = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	if (!archive) throw new Error('Native MIDI fixture did not export');
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Musical MIDI.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await editor.locator('[data-clip-id="clip"] .clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Piano roll (beta)']);
	const panel = editor.getByLabel('Piano roll (beta)', { exact: true });
	const bar = panel.getByText('Notes', { exact: true }).locator('..');
	const bounds = await bar.boundingBox(); if (!bounds) throw new Error('Piano-roll source strip is not visible');
	expect(bounds.width).toBeGreaterThan(90);
	const x = bounds.x + bounds.width - 2, y = bounds.y + bounds.height / 2;
	await page.mouse.move(x, y); await page.mouse.down();
	await page.mouse.move(x - 25, y, { steps: 4 }); await page.mouse.up();
	const duration = async () => {
		const saved = await persistedProject(page, project.id), savedClip = saved.clips.find(entry => entry.id === clip.id);
		return resolveRuntimeClipProjection(saved, savedClip).durationFrames;
	};
	await expect.poll(duration).toBe(36_000);
	const saved = await persistedProject(page, project.id), savedClip = saved.clips.find(entry => entry.id === clip.id);
	expect(readMidiClip(savedClip).notes).toEqual(notes);
	expect(savedClip.sourceDurationFrames).toBe(36_000);
	expect(savedClip.anchor).toBe(musical ? 'musical' : 'sample');
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await expect.poll(duration).toBe(48_000);
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); await expect.poll(duration).toBe(36_000);
});
