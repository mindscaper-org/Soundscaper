/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { withSoundscaperNativeMidiBridge } from '../src/common/editor/controller/track-audio/native-midi-instrument-runtime.ts';
import type { SoundscaperNativePluginHostBridgeV1 } from '../src/common/editor/native-plugin-host-contract.ts';
import { createMidiTrack } from '../src/common/editor/midi-factory.ts';
import { readMidiTrack } from '../src/common/editor/midi-model.ts';

function fixture() {
	const events = new EventTarget();
	const project = { id: 'p', sampleRate: 8000, tracks: [createMidiTrack({ id: 'm', name: 'MIDI' }, 8000)] };
	let current: unknown = project;
	let opened = 0, closed = 0;
	const ports: MessageChannel[] = [];
	const refused = async (): Promise<never> => { throw new Error('unavailable'); };
	const raw: SoundscaperNativePluginHostBridgeV1 & { listNativePlugins(): Promise<{ entries: { entryId: string; format: string; name: string; vendor: string; eligible: boolean; ineligibleReason: null; classification: string; installations: { installationId: string; version: string; allowed: boolean; selected: boolean; quarantined: boolean }[] }[] }> } = {
		listNativePlugins: async () => ({ entries: [{ entryId: 'synth', format: 'vst3', name: 'Synth', vendor: 'Test', classification: 'instrument', eligible: true, ineligibleReason: null,
			installations: [{ installationId: 'installation', version: '1', allowed: true, selected: true, quarantined: false }] }] }),
		instantiateNativePlugin: async request => {
			opened++;
			const channel = new MessageChannel(); ports.push(channel);
			channel.port1.on('message', (request: { requestId: string; kind: string }) => {
				channel.port1.postMessage({ protocolVersion: 1, requestId: request.requestId, kind: 'state', bytes: new Uint8Array([1]), reportedLatencyFrames: 0 });
			});
			queueMicrotask(() => events.dispatchEvent(Object.assign(new Event('message'), { source: events,
				data: { type: 'soundscaper-native-plugin-rpc-port-v1', offer: { instanceId: request.instanceId, portContractVersion: 1, purpose: 'plugin-rpc' } }, ports: [channel.port2] })));
			return { instanceId: request.instanceId!, entryId: 'synth', stablePluginId: 'synth', format: 'vst3', binarySha256: 'a'.repeat(64),
				inputChannels: 0, outputChannels: 2, state: 'ready', enabled: true, bypassed: false, latencySamples: 0 };
		},
		closeNativePluginInstance: async () => { closed++; return true; },
		setNativePluginInstallationAllowed: refused, selectNativePluginInstallation: refused, runNativePluginOffline: refused, setNativePluginBypassed: refused,
		persistNativePluginState: refused, restoreNativePluginState: refused, openNativePluginVendorUi: refused, closeNativePluginVendorUi: refused,
	};
	const runtime = withSoundscaperNativeMidiBridge({ bridge: raw, windowValue: events as Pick<Window, 'addEventListener' | 'removeEventListener'>,
		controller: { get project() { return current; }, getSnapshot: () => ({ selectedTrackId: 'm' }), actions: { midi: {
			setInstrument: async () => { throw new Error('publication rejected'); },
		} } } }, { bridge: raw, dispose: async () => undefined });
	return { runtime, project, opened: () => opened, closed: () => closed, setProject: (value: unknown) => { current = value; },
		async cleanup() { await runtime.dispose(); for (const channel of ports) { channel.port1.close(); channel.port2.close(); } } };
}

test('native instrument assignment requires a selected MIDI carrier before opening a process', async () => {
	const f = fixture();
	f.setProject({ ...f.project, tracks: [{ id: 'm', type: 'audio' }] });
	try {
		await assert.rejects(f.runtime.bridge.instantiateNativePlugin({ installationId: 'installation', instanceId: null }), /Select a MIDI track/);
		assert.equal(f.opened(), 0);
	} finally { await f.cleanup(); }
});

test('failed instrument publication closes its native session and preserves the old assignment', async () => {
	const f = fixture();
	try {
		await assert.rejects(f.runtime.bridge.instantiateNativePlugin({ installationId: 'installation', instanceId: null }), /publication rejected/);
		assert.equal(f.opened(), 1);
		assert.equal(f.closed(), 1);
		assert.equal(readMidiTrack(f.project.tracks[0])?.instrument, 'triangle');
	} finally { await f.cleanup(); }
});
