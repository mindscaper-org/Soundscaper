/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { MessagePort } from 'node:worker_threads';

import type {
	FramescaperNativeCheckpointLifecycleRequest,
	FramescaperNativePublicationLifecycleRequest,
	FramescaperNativeQueueEnqueueRequest,
} from '../../desktop/native-services-lifecycle-contracts.ts';
import type {
	FramescaperNativePublicationResult,
	NativeImageSequenceCheckpointResultV1,
} from '../../desktop/native-services-publication.ts';
import type {
	FramescaperNativeQueueProjection,
	FramescaperNativeServicesBridge,
} from '../../src/common/editor/ui/framescaper-native-services-bridge.ts';
import { loadPreload } from './framescaper-native-services-preload-fixture.mjs';

type NativeServices = Omit<FramescaperNativeServicesBridge, 'enqueue'> & {
	enqueue(request: FramescaperNativeQueueEnqueueRequest): Promise<FramescaperNativeQueueProjection>;
	publish(request: FramescaperNativePublicationLifecycleRequest): Promise<FramescaperNativePublicationResult>;
	checkpoint(request: FramescaperNativeCheckpointLifecycleRequest): Promise<NativeImageSequenceCheckpointResultV1>;
};

const METHODS = [
	'snapshot', 'capabilities', 'preferences', 'setPreference', 'control', 'reorder', 'remove',
	'enqueue', 'abandonRenderInputs', 'selectRoot', 'revalidateRoot', 'revokeRoot',
	'createWatch', 'setWatchEnabled', 'removeWatch', 'reconcileWatch', 'claimWatchImport',
	'cleanupScratch', 'publish', 'checkpoint', 'selectImageSequence',
	'scanOpenFxPlugin', 'listOpenFxPlugins', 'controlOpenFxPlugin', 'runOpenFxInteract',
	'externalDisplays', 'setExternalDisplay', 'presentExternalDisplay',
] as const satisfies readonly (keyof NativeServices)[];

type TestBridge = Required<Pick<NativeServices, (typeof METHODS)[number]>>;

/** Use the real bundle and model the Electron boundaries around its VM. */
export async function loadFramescaperNativeServicesTestBridge(
	invoke: (channel: string, request: unknown) => unknown,
	postMessage: (channel: string, request: unknown, ports: readonly MessagePort[]) => void = (channel) => {
		throw new Error(`Unexpected native services MessagePort channel ${channel}.`);
	},
): Promise<TestBridge> {
	const loaded = await loadPreload([], {
		invoke: (channel, request) => invoke(channel, structuredClone(request)),
		postMessage: (channel, request, ports) => postMessage(channel, structuredClone(request), ports),
	});
	const desktop: unknown = loaded.bridge;
	assert.ok(desktop && typeof desktop === 'object' && 'nativeServices' in desktop);
	const services = desktop.nativeServices;
	assert.ok(services && typeof services === 'object');
	const methods = METHODS.map((name) => {
		const method: unknown = Reflect.get(services, name);
		assert.ok(typeof method === 'function', `Framescaper preload is missing nativeServices.${name}.`);
		const call = method as (request: unknown) => Promise<unknown>;
		return [name, async (request: unknown) => structuredClone(await call(structuredClone(request)))] as const;
	});
	return Object.freeze(Object.fromEntries(methods)) as TestBridge;
}
