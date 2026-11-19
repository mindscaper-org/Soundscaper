/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { audioBufferChannels } from '../src/common/editor/rendered-audio-channels.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { ardourNormalizedFlacFiles, ardourSourceGainSession } from './helpers/ardour-source-gain-fixture.ts';

for (const layout of ['mono', 'split', 'interleaved'] as const) for (const gains of [[.25, .5], [.25, .25], [0, 0], [1, 1]]) {
	test(`Ardour File Import restores archived source gain, layout=${layout}, gains=${gains.join(',')}`, async context => {
		const native = createNodeWebAudioEngineFactory(context), engine = native.createEngine();
		const { controller } = await controllerSession(context, { engine, engineFactory: native.createEngine });
		const originalFetch = globalThis.fetch;
		globalThis.fetch = async (input, options) => input instanceof URL && input.protocol === 'file:'
			? new Response(Uint8Array.from(await readFile(input))) : originalFetch(input, options);
		try {
			await controller.actions.project.importFiles([
				new File([ardourSourceGainSession(layout, gains)], 'Archived.ardour', { type: 'application/xml' }),
				...(await ardourNormalizedFlacFiles(layout)).map(file => new File([file.bytes], file.name, { type: 'audio/flac' })),
			]);
			assert.equal(controller.project?.clips.length, layout === 'split' || layout === 'interleaved' && gains[0] !== gains[1] ? 2 : 1,
				'equal interleaved channel gains retain the single stereo source view');
			const pcm = audioBufferChannels(await engine.renderMix({ startFrame: 0, endFrame: 4800, includeTail: false }));
			const left = .5 * .5 * gains[0]! * (layout === 'mono' ? Math.SQRT1_2 : 1);
			assert.ok(Math.abs(pcm[0]![1200]! - left) < .00001, `normalized archive left sample ${String(pcm[0]![1200])} must equal ${String(left)}`);
			const right = layout === 'mono' ? left : -.5 * .5 * gains[1]!;
			assert.ok(Math.abs(pcm[1]![1200]! - right) < .00001, `normalized archive right sample ${String(pcm[1]![1200])} must equal ${String(right)}`);
		} finally { globalThis.fetch = originalFetch; await controller.dispose(); await native.dispose(); }
	});
}
