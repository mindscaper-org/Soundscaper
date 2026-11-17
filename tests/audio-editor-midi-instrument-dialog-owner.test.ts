/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperNativeServicesSurfaceHost } from '../src/common/editor/ui/workspace/SoundscaperNativeServicesSurface.tsx';
import type { SoundscaperNativeServicesBridge } from '../src/common/editor/ui/soundscaper-native-services-bridge.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createMidiTrack } from '../src/common/editor/midi-factory.ts';

for (const change of ['track', 'activation', 'instrument'] as const) test(`Instrument settings retires its editor after a different ${change}`, async context => {
	let selectedTrackId = 'first';
	const generation = new EditorProjectGeneration(); generation.activate('project');
	const controller = { project: { id: 'project', tracks: [createMidiTrack({ id: 'first' }), createMidiTrack({ id: 'second' })] },
		getSnapshot: () => ({ selectedTrackId }), captureProjectGeneration: generation.capture.bind(generation) };
	const closed: string[] = [];
	const bridge = {
		instantiateNativePlugin: async () => ({ instanceId: 'editor-first', format: 'vst3', classification: 'instrument', state: 'ready', enabled: true,
			bypassed: false, stablePluginId: 'synth', binarySha256: 'a'.repeat(64), latencySamples: 0, inputChannels: 0, outputChannels: 2, entryId: 'synth' }),
		closeNativePluginInstance: async ({ instanceId }: { instanceId: string }) => { closed.push(instanceId); return true; },
	} as unknown as SoundscaperNativeServicesBridge;
	const host = createSoundscaperNativeServicesSurfaceHost({ bridge,
		controller: controller as unknown as Parameters<typeof createSoundscaperNativeServicesSurfaceHost>[0]['controller'],
		documentValue: { createElement: () => ({ dataset: {}, remove() {} }), querySelector: () => null, body: { append() {} } } as unknown as Document,
		createHostRoot: () => ({ render() {}, unmount() {} }),
	});
	context.after(async () => { await host.dispose(); });
	host.open('native-instrument-manage');
	await host.dialogRuntime.perform({ type: 'instantiate-plugin', installationId: 'installed' });
	assert.equal(host.dialogRuntime.getState().pluginInstance?.instanceId, 'editor-first');
	const original = host.dialogRuntime;
	host.close(); host.open('native-instrument-manage');
	assert.equal(host.dialogRuntime, original, 'reopening the same track keeps its editor');
	host.close();
	if (change === 'track') selectedTrackId = 'second';
	else if (change === 'activation') generation.activate('project');
	else controller.project = { ...controller.project, tracks: [createMidiTrack({ id: 'first', instrument: 'square' }), controller.project.tracks[1]!] };
	host.open('native-instrument-manage');
	assert.notEqual(host.dialogRuntime, original);
	assert.equal(host.dialogRuntime.getState().pluginInstance, null, 'another owner must not inherit the old editor controls');
	assert.deepEqual(closed, ['editor-first']);
});
