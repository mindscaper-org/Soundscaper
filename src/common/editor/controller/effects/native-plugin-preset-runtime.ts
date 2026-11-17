/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSerialProjectOperationQueue } from '../shared/serial-project-operation-queue.ts';
import type { SoundscaperNativePluginHostBridgeV1 } from '../../native-plugin-host-contract.ts';

const bridges = new WeakMap<object, SoundscaperNativePluginHostBridgeV1>();
const listeners = new Map<string, Set<() => void>>();

export function bindNativePluginPresetBridge(owner: object, bridge: SoundscaperNativePluginHostBridgeV1): () => void {
	bridges.set(owner, bridge);
	return () => { if (bridges.get(owner) === bridge) bridges.delete(owner); };
}

export function nativePluginPresetBridge(owner: unknown): SoundscaperNativePluginHostBridgeV1 | null {
	return owner && typeof owner === 'object' ? bridges.get(owner) ?? null : null;
}

interface NativeRackPowerController {
	readonly actions: Readonly<{ effects: Readonly<{
		update(scope: string, targetId: string | null, effectId: string, changes: Readonly<{ enabled: boolean }>): unknown;
	}> }>;
}

/** The native host owns bypass; re-enable a slot disabled by older rack controls. */
export async function setNativeRackEffectEnabled(controller: NativeRackPowerController, scope: string, targetId: string | null,
	effect: Readonly<{ id: string; enabled?: boolean; params: Readonly<{ instanceId: string }> }>, enabled: boolean,
	isCurrent: () => boolean): Promise<void> {
	if (!isCurrent()) return;
	const bridge = nativePluginPresetBridge(controller);
	if (bridge) await bridge.setNativePluginBypassed({ instanceId: effect.params.instanceId, bypassed: !enabled });
	if (isCurrent() && (!bridge || enabled && effect.enabled === false)) {
		controller.actions.effects.update(scope, targetId, effect.id, { enabled });
	}
}

export function subscribeNativePluginPresetRestores(instanceId: string, listener: () => void): () => void {
	let group = listeners.get(instanceId);
	if (!group) { group = new Set(); listeners.set(instanceId, group); }
	group.add(listener);
	return () => { group.delete(listener); if (!group.size) listeners.delete(instanceId); };
}

/** Full opaque state goes through the authenticated, project-fenced native state service. */
export function createNativePluginPresetAdapter(bridge: SoundscaperNativePluginHostBridgeV1, identity: Readonly<{
	instanceId: string; format: string; stablePluginId: string; binarySha256: string;
}>, flushParameters: () => PromiseLike<unknown> | unknown = () => undefined) {
	return {
		async read(): Promise<Readonly<Record<string, unknown>>> {
			await flushParameters();
			if (!bridge.captureNativePluginPreset) throw new Error('Native plug-in preset capture is unavailable.');
			const { bytes } = await bridge.captureNativePluginPreset({ instanceId: identity.instanceId });
			if (!(bytes instanceof Uint8Array) || bytes.byteLength > 16 * 1024 * 1024) throw new RangeError('Invalid native preset size.');
			let binary = '';
			for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
			return { format: identity.format, stablePluginId: identity.stablePluginId,
				binarySha256: identity.binarySha256, state: btoa(binary) };
		},
		async apply(params: Readonly<Record<string, unknown>>): Promise<void> {
			if (params.format !== identity.format || params.stablePluginId !== identity.stablePluginId
				|| params.binarySha256 !== identity.binarySha256) throw new Error('This preset belongs to a different plug-in or binary version.');
			if (typeof params.state !== 'string' || params.state.length > 22369624 || !bridge.restoreNativePluginPreset) throw new TypeError('Invalid native plug-in preset state.');
			const binary = atob(params.state);
			const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
			if (bytes.length > 16 * 1024 * 1024) throw new RangeError('Invalid native preset size.');
			await flushParameters();
			await bridge.restoreNativePluginPreset({ instanceId: identity.instanceId, bytes });
			for (const listener of listeners.get(identity.instanceId) ?? []) listener();
		},
	};
}

/** Inline bytes keep user presets independent of project-body reclamation and portable on export. */
export function createNativePluginPresetStatePort<Operation extends { isCurrent(): boolean; assertCurrent(): void }>(dependencies: {
	readonly queue: ReturnType<typeof createSerialProjectOperationQueue<Operation>>;
	readonly read: (instanceId: string) => Promise<Readonly<{ bytes: Uint8Array }>>;
	readonly load: (instanceId: string, bytes: Uint8Array) => Promise<unknown>;
	readonly persist: (operation: Operation, request: { instanceId: string; generation: number }) => Promise<unknown>;
}) {
	return {
		captureNativePluginPreset: dependencies.queue.wrap(async (operation, request: { instanceId: string }) => {
			const state = await dependencies.read(request.instanceId); operation.assertCurrent();
			return { bytes: state.bytes };
		}),
		restoreNativePluginPreset: dependencies.queue.wrap(async (operation, request: { instanceId: string; bytes: Uint8Array }) => {
			await dependencies.load(request.instanceId, request.bytes); operation.assertCurrent();
			return await dependencies.persist(operation, { instanceId: request.instanceId, generation: 1 });
		}),
	};
}
