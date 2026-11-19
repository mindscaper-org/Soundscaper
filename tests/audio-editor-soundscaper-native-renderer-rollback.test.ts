/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareNativePluginOfflineRuntimes } from '../src/common/editor/native-plugin-realtime-node.js';
import { createSoundscaperNativeRendererBridge } from '../src/common/editor/ui/soundscaper-native-renderer-bridge.ts';
import { audioRequest, isProjectOwnershipLoss, pluginState, rollbackFixture, useFakeAudioWorklet } from './helpers/native-renderer-rollback-fixture.ts';

test('a failed audio-open rollback remains owned for workspace teardown', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, false);
	fixture.failNextAudioClose();
	await assert.rejects(() => renderer.bridge.openNativeAudioSession({
		...audioRequest(), sampleRate: 44_100,
	}), /context rate/u);
	assert.equal(fixture.active().audio.length, 1, 'main still owns the session whose rollback failed');
	await renderer.dispose();
	assert.deepEqual(fixture.active().audio, [], 'workspace teardown retries that session');
	assert.equal(fixture.audioCloses.length, 2);
});

test('a failed plug-in setup rollback remains owned for workspace teardown', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, false);
	fixture.refuseInitialPersistence();
	fixture.failNextPluginClose();
	await assert.rejects(() => renderer.bridge.instantiateNativePlugin({
		installationId: 'installation-1', instanceId: null,
	}), /initial native plug-in state/u);
	assert.equal(fixture.active().plugins.length, 1, 'main still owns the instance whose rollback failed');
	await renderer.dispose();
	assert.deepEqual(fixture.active().plugins, [], 'workspace teardown retries that instance');
	assert.equal(fixture.pluginCloses.length, 2);
});

test('a failed reconciliation close cannot orphan an active plug-in', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, true);
	await renderer.bridge.instantiateNativePlugin({ installationId: 'installation-1', instanceId: null });
	fixture.project.nativePluginStates = [];
	fixture.failNextPluginClose();
	assert.deepEqual(await renderer.restoreProjectNativePlugins(), []);
	assert.equal(fixture.active().plugins.length, 1, 'the refused main close leaves the helper live');
	await renderer.dispose();
	assert.deepEqual(fixture.active().plugins, [], 'workspace teardown retains and retries its ownership');
	assert.equal(fixture.pluginCloses.length, 2);
});

test('a failed offline-runtime close remains owned for workspace teardown', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture({ seeded: true });
	const renderer = createRenderer(fixture, false);
	const runtimes = await prepareNativePluginOfflineRuntimes(fixture.audioContext, fixture.project, {
		trackId: 'track-1', includeMaster: false,
	});
	fixture.failNextPluginClose();
	await runtimes.dispose();
	assert.equal(fixture.active().plugins.length, 1, 'main still owns the offline helper whose close failed');
	await renderer.dispose();
	assert.deepEqual(fixture.active().plugins, [], 'workspace teardown retries the offline helper');
	assert.equal(fixture.pluginCloses.length, 2);
});

test('workspace teardown reports failed closes and retries retained ownership', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, false);
	const opened = await renderer.bridge.openNativeAudioSession(audioRequest());
	assert.equal(opened.status, 'opened');
	if (opened.status !== 'opened') return;
	const instance = await renderer.bridge.instantiateNativePlugin({
		installationId: 'installation-1', instanceId: null,
	});
	fixture.failNextAudioClose();
	fixture.failNextPluginClose();
	await assert.rejects(renderer.dispose());
	assert.deepEqual(fixture.active(), {
		audio: [opened.sessionId], plugins: [instance.instanceId],
	}, 'rejected teardown closes remain renderer-owned');
	await renderer.dispose();
	assert.deepEqual(fixture.active(), { audio: [], plugins: [] });
	assert.equal(fixture.audioCloses.length, 2);
	assert.equal(fixture.pluginCloses.length, 2);
});

test('workspace teardown waits for an in-flight open before snapshotting ownership', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, false);
	const gate = fixture.deferNextAudioOpen();
	const opening = renderer.bridge.openNativeAudioSession(audioRequest());
	await gate.started;
	let disposalSettled = false;
	const disposal = renderer.dispose().then(() => { disposalSettled = true; });
	await new Promise<void>((resolve) => setImmediate(resolve));
	const settledBeforeOpen = disposalSettled;
	fixture.failNextAudioClose();
	gate.resolve();
	const settlements = await Promise.allSettled([opening, disposal]);
	assert.equal(settledBeforeOpen, false, 'teardown must wait for ownership-establishing operations');
	assert.equal(settlements[0]?.status, 'rejected');
	assert.equal(settlements[1]?.status, 'fulfilled');
	assert.deepEqual(fixture.active().audio, [], 'teardown retries the late failed rollback');
	assert.equal(fixture.audioCloses.length, 2);
});

test('native bypass transitions retain latency and an explicit un-bypass reinstates a faulted plug-in', async (context) => {
	const worklet = useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, true);
	const instance = await renderer.bridge.instantiateNativePlugin({ installationId: 'installation-1', instanceId: null });
	await renderer.bridge.setNativePluginBypassed({ instanceId: instance.instanceId, bypassed: true });
	await renderer.restoreProjectNativePlugins();
	assert.deepEqual(fixture.pluginCloses, [], 'rack bypass keeps its owned helper available for re-enabling');
	await renderer.bridge.setNativePluginBypassed({ instanceId: instance.instanceId, bypassed: false });
	await renderer.restoreProjectNativePlugins();
	assert.deepEqual(fixture.pluginCloses, [], 're-enabling preserves the same authenticated runtime');
	assert.equal(fixture.effect().bypassed, false, 'an ordinary un-bypass must not fault the plug-in');
	assert.equal(fixture.effect().params.latencyFrames, 512, 'a control transition is not a latency report');

	worklet.faultPlugin();
	await renderer.bridge.setNativePluginBypassed({ instanceId: instance.instanceId, bypassed: false });
	assert.equal(fixture.effect().bypassed, false, 'the explicit un-bypass reinstates the project slot');
	assert.equal(fixture.pluginBypasses.at(-1)?.bypassed, false, 'main receives the explicit reinstatement');
	assert.equal(worklet.bypassMessages().at(-1)?.bypassed, false, 'the realtime worklet receives it too');
	await renderer.dispose();
});

test('reconciliation does not instantiate a saved bypassed plug-in', async context => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture({ seeded: true });
	fixture.project.nativePluginStates[0] = pluginState(fixture.project.nativePluginStates[0]!.instanceId, true);
	const renderer = createRenderer(fixture, true);
	assert.deepEqual(await renderer.restoreProjectNativePlugins(), []);
	assert.deepEqual(fixture.active().plugins, []);
	await renderer.dispose();
});

test('a late bypass reply cannot change a replacement project', async context => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, true);
	const instance = await renderer.bridge.instantiateNativePlugin({ installationId: 'installation-1', instanceId: null });
	const gate = fixture.deferNextPluginBypass();
	const bypass = renderer.bridge.setNativePluginBypassed({ instanceId: instance.instanceId, bypassed: true });
	await gate.started;
	const replacement = fixture.switchProject();
	gate.resolve();
	await assert.rejects(bypass, isProjectOwnershipLoss);
	assert.deepEqual(replacement.nativePluginStates, []);
	await renderer.dispose();
});

test('removing a native rack effect cannot poison later native plug-in actions', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, true);
	const instance = await renderer.bridge.instantiateNativePlugin({
		installationId: 'installation-1', instanceId: null,
	});
	fixture.project.tracks[0]!.effects.splice(0);
	await assert.doesNotReject(() => renderer.bridge.setNativePluginBypassed({
		instanceId: instance.instanceId,
		bypassed: true,
	}));
	await renderer.dispose();
});

test('late native instantiation cannot author into a replacement project', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, true);
	const gate = fixture.deferNextPluginPersistence();
	const instantiation = renderer.bridge.instantiateNativePlugin({
		installationId: 'installation-1', instanceId: null,
	});
	await gate.started;
	const replacement = fixture.switchProject();
	gate.resolve();

	await assert.rejects(instantiation, isProjectOwnershipLoss);
	assert.deepEqual(replacement.tracks[0]?.effects, []);
	assert.deepEqual(replacement.nativePluginStates, []);
	assert.deepEqual(fixture.active().plugins, [], 'the late acquired helper instance is closed');
	await renderer.dispose();
});

test('project retirement aborts native instantiation before the project reference changes', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, true);
	const gate = fixture.deferNextPluginPersistence();
	const instantiation = renderer.bridge.instantiateNativePlugin({
		installationId: 'installation-1', instanceId: null,
	});
	await gate.started;
	fixture.retireProject();
	gate.resolve();

	await assert.rejects(instantiation, isProjectOwnershipLoss);
	assert.deepEqual(fixture.project.tracks[0]?.effects, []);
	assert.deepEqual(fixture.project.nativePluginStates, []);
	assert.deepEqual(fixture.active().plugins, [], 'the retiring project releases its late helper');
	await renderer.dispose();
});

test('native instantiation authors into the track selected when the operation began', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, true);
	const gate = fixture.deferNextPluginPersistence();
	const instantiation = renderer.bridge.instantiateNativePlugin({
		installationId: 'installation-1', instanceId: null,
	});
	await gate.started;
	fixture.selectTrack('track-2');
	gate.resolve();

	await instantiation;
	assert.equal(fixture.project.tracks[0]!.effects.length, 1);
	assert.equal(fixture.project.tracks[1]!.effects.length, 0);
	await renderer.dispose();
});

test('late native persistence cannot upsert state into a replacement project', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, true);
	const instance = await renderer.bridge.instantiateNativePlugin({
		installationId: 'installation-1', instanceId: null,
	});
	const gate = fixture.deferNextPluginPersistence();
	const persistence = renderer.bridge.persistNativePluginState({
		instanceId: instance.instanceId, generation: 2,
	});
	await gate.started;
	const replacement = fixture.switchProject();
	gate.resolve();

	await assert.rejects(persistence, isProjectOwnershipLoss);
	assert.deepEqual(replacement.nativePluginStates, []);
	await renderer.dispose();
});

test('late explicit native restore cannot upsert state into a replacement project', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture();
	const renderer = createRenderer(fixture, true);
	const instance = await renderer.bridge.instantiateNativePlugin({
		installationId: 'installation-1', instanceId: null,
	});
	const gate = fixture.deferNextPluginRestore();
	const restoration = renderer.bridge.restoreNativePluginState({
		instanceId: instance.instanceId, generation: 2,
		stateBody: pluginState(instance.instanceId).stateBody,
	});
	await gate.started;
	const replacement = fixture.switchProject();
	gate.resolve();

	await assert.rejects(restoration, isProjectOwnershipLoss);
	assert.deepEqual(replacement.nativePluginStates, []);
	await renderer.dispose();
});

test('late project reconciliation closes its acquired instance without touching the replacement', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture({ seeded: true });
	const renderer = createRenderer(fixture, true);
	const gate = fixture.deferNextPluginRestore();
	const restoration = renderer.restoreProjectNativePlugins();
	await gate.started;
	const replacement = fixture.switchProject();
	gate.resolve();

	await assert.rejects(restoration, isProjectOwnershipLoss);
	assert.deepEqual(replacement.nativePluginStates, []);
	assert.deepEqual(fixture.active().plugins, [], 'the stale reconciliation releases its acquired helper');
	await renderer.dispose();
});

test('project reconciliation replaces a live instance reused by a different project', async (context) => {
	useFakeAudioWorklet(context);
	const fixture = rollbackFixture({ seeded: true });
	const renderer = createRenderer(fixture, true);
	const restored = [{ instanceId: fixture.project.nativePluginStates[0]!.instanceId, status: 'restored' }];
	assert.deepEqual(await renderer.restoreProjectNativePlugins(), restored);
	fixture.switchProject(true);

	assert.deepEqual(await renderer.restoreProjectNativePlugins(), restored);
	assert.deepEqual(fixture.pluginCloses, [fixture.project.nativePluginStates[0]!.instanceId],
		'the first project\'s live helper is not reused by the replacement');
	await renderer.dispose();
});

function createRenderer(fixture: ReturnType<typeof rollbackFixture>, withController: boolean) {
	return createSoundscaperNativeRendererBridge({
		bridge: fixture.bridge,
		engine: fixture.engine,
		controller: withController ? fixture.controller : null,
		windowValue: fixture.windowValue,
	});
}
