/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffectMacroStep } from '../src/common/editor/effect-macro-steps.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { clipboardProject } from './helpers/clipboard-source-custody.ts';
import { macroDspCustody, macroRecording } from './helpers/macro-dsp-custody.ts';

test('a sixteen-track Normalize macro admits sequential scratch and writes every real result', { timeout: 120_000 }, async context => {
	const custody = await macroDspCustody(context);
	try {
		const { controller, store } = custody;
		const recording = macroRecording('Microphone.wav', 330, 480_000, 2, .2);
		await controller.actions.project.importFiles(Array.from({ length: 16 }, (_, index) =>
			new File([recording.bytes], `Microphone ${String(index + 1)}.wav`, { type: 'audio/wav' })));
		controller.actions.timeline.selectAll();
		const before = clipboardProject(controller.project);
		assert.equal(before.clips.length, 16);
		assert.ok((before.selection.trackIds?.length ?? 0) >= 16, JSON.stringify(before.selection));
		await assert.doesNotReject(controller.actions.macros.run({ name: 'Normalize microphones',
			effects: [createEffectMacroStep('audacity-normalize', { params: { peakDb: -1 } })] }));
		const after = clipboardProject(controller.project);
		assert.equal(after.clips.length, 16);
		for (const clip of after.clips) {
			const source = after.sources.find(candidate => candidate.id === clip.sourceId);
			assert.ok(source?.kind === 'audio');
			assert.ok(before.sources.every(original => original.id !== source.id));
			const channels = await readCustodyPcm(store, source);
			assert.deepEqual(channels.map(channel => channel.length), [480_000, 480_000]);
			for (const channel of channels) {
				const peak = channel.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
				assert.ok(Math.abs(peak - 10 ** (-1 / 20)) < 1e-4, `normalized source peak ${String(peak)}`);
			}
		}
	} finally { await custody.dispose(); }
});
