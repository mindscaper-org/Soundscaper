/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import type { EngineAudioContext } from '../src/common/editor/engine/public-api.ts';
import { MockAudioContext } from './helpers/mock-audio-context.js';
import { deferred } from './helpers/async-test-control.ts';

test('selecting the current physical output preserves its live context without reopening the sink', async context => {
	const calls: string[] = [];
	class OutputContext extends MockAudioContext {
		sinkId = '';
		async setSinkId(deviceId: string): Promise<void> {
			calls.push(deviceId);
			if (deviceId === this.sinkId) throw new Error('Reopening the current sink interrupted its audio device.');
			this.sinkId = deviceId;
		}
	}
	const audio = new OutputContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => audio as unknown as EngineAudioContext });
	context.after(() => engine.dispose());
	await engine.getAudioContext({ resume: false });
	for (const deviceId of ['', 'speakers-a', 'speakers-a', '', '']) {
		const result = await engine.setOutputDevice(deviceId);
		assert.equal(result.activeDeviceId, deviceId);
		assert.equal(result.preferredDeviceId, deviceId);
		assert.equal(result.error, null);
	}
	assert.deepEqual(calls, ['speakers-a', '']);
	assert.equal(await engine.getAudioContext({ resume: false }), audio);
});

test('selecting the current output still supersedes an older pending physical switch', async context => {
	const gate = deferred<void>();
	const calls: string[] = [];
	class OutputContext extends MockAudioContext {
		sinkId = '';
		async setSinkId(deviceId: string): Promise<void> {
			calls.push(deviceId);
			if (deviceId === 'speakers-a') await gate.promise;
			this.sinkId = deviceId;
		}
	}
	const audio = new OutputContext();
	const engine = createAudioEditorEngine({ audioContextFactory: () => audio as unknown as EngineAudioContext });
	context.after(async () => { gate.resolve(); await engine.dispose(); });
	await engine.getAudioContext({ resume: false });
	const older = engine.setOutputDevice('speakers-a');
	try {
		assert.equal((await engine.setOutputDevice('')).activeDeviceId, '');
		assert.deepEqual(calls, ['speakers-a'], 'the newer choice must not reopen the current default sink');
	} finally { gate.resolve(); await older; }
	assert.equal(engine.getOutputDeviceState().activeDeviceId, '');
	assert.equal(audio.sinkId, '', 'a late physical switch must reconcile to the newer default choice');
	assert.deepEqual(calls, ['speakers-a', '']);
});
