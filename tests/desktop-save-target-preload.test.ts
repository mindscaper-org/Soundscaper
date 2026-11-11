/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSaveTargetPreload } from '../desktop/save-target-preload.ts';

test('batch chooser and per-file targets cross only the existing save capability channel', async () => {
	const calls: unknown[] = [], id = 'a'.repeat(48);
	const bridge = createSaveTargetPreload({ channel: 'save:choose', text: value => String(value),
		invoke: async (channel, value) => {
			calls.push([channel, value]);
			return (value as { kind: string }).kind === 'macro-file-folder' ? { id, name: 'Output', displayPath: '/chosen/Output', files: ['episode.wav'] } : { id, name: 'episode.wav' };
		},
	});
	assert.deepEqual(await bridge.chooseBatchSaveDirectory({ suggestedNames: ['episode.wav'] }), { id, name: 'Output', displayPath: '/chosen/Output', files: ['episode.wav'] });
	await bridge.prepareBatchSaveTarget({ batchId: id, index: 0 });
	assert.deepEqual(calls, [['save:choose', { kind: 'macro-file-folder', suggestedNames: ['episode.wav'] }],
		['save:choose', { kind: 'macro-file-target', batchId: id, index: 0 }]]);
	await assert.rejects(bridge.chooseBatchSaveDirectory({ suggestedNames: ['../escape.wav'] }));
	await assert.rejects(bridge.chooseBatchSaveDirectory({ suggestedNames: ['episode\n.wav'] }));
	await assert.rejects(bridge.prepareBatchSaveTarget({ batchId: '/tmp/output', index: 0 }));
});

test('folder selection exposes a display path and plans outputs without selecting again', async () => {
	const calls: unknown[] = [], batchId = 'b'.repeat(48);
	const bridge = createSaveTargetPreload({ channel: 'save:choose', text: value => String(value),
		invoke: async (channel, request) => {
			calls.push([channel, request]);
			return { id: batchId, name: 'Output', displayPath: '/chosen/Output', files: (request as { suggestedNames: string[] }).suggestedNames };
		},
	});
	assert.deepEqual(await bridge.chooseBatchSaveDirectory(), { id: batchId, name: 'Output', displayPath: '/chosen/Output', files: [] });
	assert.deepEqual(await bridge.planBatchSaveOutputs({ batchId, suggestedNames: ['first.wav', 'second.flac'] }),
		{ id: batchId, name: 'Output', displayPath: '/chosen/Output', files: ['first.wav', 'second.flac'] });
	assert.deepEqual(calls, [
		['save:choose', { kind: 'macro-file-folder', suggestedNames: [] }],
		['save:choose', { kind: 'macro-file-plan', batchId, suggestedNames: ['first.wav', 'second.flac'] }],
	]);
	await assert.rejects(bridge.planBatchSaveOutputs({ batchId: '/chosen/Output', suggestedNames: ['first.wav'] }));
	await assert.rejects(bridge.planBatchSaveOutputs({ batchId, suggestedNames: ['../escape.wav'] }));
	await assert.rejects(bridge.planBatchSaveOutputs({ batchId, suggestedNames: [] }));
});
