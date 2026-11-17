/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioBuffer } from 'node-web-audio-api';
import { createNodeWebAudioEngineFactory } from './helpers/node-web-audio-engine.ts';
import { createEffect } from '../src/common/editor/effects.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand as apply } from '../src/soundscaper/editor-project-commands.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import type { EngineEffect } from '../src/common/editor/engine/types.ts';

for (const multiple of [false, true]) test(`deleting ${multiple ? 'a control folder' : 'a control track'} leaves a playable clip rack`, async context => {
	const controls = multiple ? ['voice', 'linked'] : ['voice'];
	const original = createSoundscaperProject({ sampleRate: 48000,
		sources: [{ id: 'source', sampleRate: 48000, channelCount: 1, frameCount: 512 }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 512, effects: [createEffect('audacity-auto-duck', { id: 'duck', context: { controlTrackId: 'voice' } })] }],
		tracks: [{ id: 'music', type: 'audio', clipIds: ['clip'] }, ...controls.map(id => ({ id, type: 'audio', clipIds: [] }))],
	});
	let current = original;
	if (multiple) {
		const sequenceId = current.sequences[0]!.id;
		current = apply(current, { type: 'track-folder/add', sequenceId, folder: { id: 'controls', name: 'Controls' } });
		for (const nodeId of controls) current = apply(current, { type: 'track-node/move', sequenceId, nodeId, parentFolderId: 'controls', index: 100 });
	}
	current = apply(current, { type: 'track/playlist-create', trackId: 'music', id: 'alternative', name: 'Alternative', originalId: 'original', originalName: 'Original', mode: 'duplicate' });
	let project = apply(current, multiple ? { type: 'track-folder/remove', folderId: 'controls', disposition: 'delete-contents' }
		: { type: 'track/remove', trackId: 'voice' });
	project = apply(project, { type: 'track/playlist-activate', trackId: 'music', id: 'original' });
	const engine = createNodeWebAudioEngineFactory(context).createEngine();
	const buffer = new AudioBuffer({ numberOfChannels: 1, length: 512, sampleRate: 48000 }); buffer.getChannelData(0).fill(.25);
	try {
		engine.loadProject(projectForRuntimeConsumers(project), new Map([['source', buffer as unknown as globalThis.AudioBuffer]]));
		await engine.renderMix({ startFrame: 0, endFrame: 512, includeTail: false });
		const effect = (project.clips[0]!.effects as readonly EngineEffect[])[0]!;
		assert.equal(effect.enabled, false);
		assert.equal(effect.context?.controlTrackId, null);
		assert.equal((original.clips[0]!.effects as readonly EngineEffect[])[0]!.enabled, true);
	} finally { await engine.dispose(); }
});
