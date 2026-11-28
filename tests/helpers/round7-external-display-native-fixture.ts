/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MessagePort } from 'node:worker_threads';
import { createFramescaperNativeExternalDisplayPort } from '../../desktop/native-services-external-display-port.ts';
import type { FramescaperExternalDisplayFrameMetadata } from '../../desktop/external-display-controller.ts';
import { initializeFramescaperNativeServicesDatabase, acquireFramescaperNativeServicesWriterLease } from '../../desktop/native-services-database.ts';
import { initializeFramescaperNativeServicesDatabaseV3 } from '../../desktop/native-services-database-v3.ts';
import { FramescaperNativeQueueRepository } from '../../desktop/native-services-queue-repository-v3.ts';
import { FramescaperNativeRootRepository } from '../../desktop/native-services-root-repository.ts';
import { FramescaperNativeWatchRepository } from '../../desktop/native-services-watch-repository.ts';
import { FramescaperNativeScratchRepository } from '../../desktop/native-services-scratch-repository.ts';
import { FramescaperNativeServicesLifecycleV3 } from '../../desktop/native-services-lifecycle-v3.ts';
import { FramescaperNativeServicesControllerV3 } from '../../desktop/native-services-controller-v3.ts';
import { registerFramescaperNativeServicesMainIpc, type FramescaperNativeServicesMainIpcOptions } from '../../desktop/native-services-main-ipc.ts';
import { FRAMESCAPER_EXTERNAL_DISPLAY_FRAME_PORT_CHANNEL } from '../../desktop/external-display-frame-port.ts';
import { NATIVE_MEDIA_CAPABILITY_IDS, createNativeMediaCapabilitySnapshotV1 } from '../../src/common/editor/native-media-capability-snapshot.ts';
import { loadFramescaperNativeServicesTestBridge } from './framescaper-native-services-test-bridge.ts';

interface PresentedFrame {
	readonly windowId: number;
	readonly sequence: number;
	readonly rgbaSha256: string;
}

/** The bundled preload and main IPC, with bounded in-memory display windows. */
export async function createRound7ExternalDisplayNativeFixture() {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperNativeServicesDatabase(database);
	initializeFramescaperNativeServicesDatabaseV3(database);
	const lease = acquireFramescaperNativeServicesWriterLease(database, {
		leaseId: 'r7-display', instanceId: 'r7-display', processId: 7, nowMs: 1_000,
	});
	const queue = new FramescaperNativeQueueRepository(database);
	const roots = new FramescaperNativeRootRepository(database);
	const watch = new FramescaperNativeWatchRepository(database);
	const scratch = new FramescaperNativeScratchRepository(database, queue);
	const frames: PresentedFrame[] = [];
	const settlements: { sequence: number; outcome: 'result' | 'failure' }[] = [];
	let holdNext = false;
	let held: { readonly sequence: number; readonly finish: () => void } | null = null;
	let windowCount = 0;
	const displays = ['Programme A', 'Programme B'].map((label, index) => ({
		displayId: `display-${String(index + 2)}`, label, primary: false,
		width: 640, height: 360, hdrCapable: false, colorManaged: false,
		bounds: { x: (index + 1) * 640, y: 0, width: 640, height: 360 },
	}));
	const externalDisplay = createFramescaperNativeExternalDisplayPort({
		platform: 'linux', linuxSessionType: 'x11', isEnabled: () => true,
		listDisplays: () => displays,
		createWindow: () => {
			const windowId = ++windowCount;
			let destroyed = false;
			return {
				load: async () => undefined, show: () => undefined,
				close: () => { destroyed = true; }, isDestroyed: () => destroyed,
				setBounds: () => undefined,
				send: async (_channel, value, pixels) => {
					const frame = value as FramescaperExternalDisplayFrameMetadata;
					assert.ok(pixels instanceof MessagePort);
					const hold = holdNext;
					holdNext = false;
					const rgba = await new Promise<unknown>((resolve, reject) => {
						pixels.once('message', resolve);
						pixels.once('messageerror', reject);
						pixels.once('close', () => reject(new Error('The fixture sink closed before receiving its pixels.')));
					}).finally(() => pixels.close());
					assert.ok(rgba instanceof Uint8Array);
					assert.equal(rgba.byteLength, frame.width * frame.height * 4);
					assert.equal(createHash('sha256').update(rgba).digest('hex'), frame.rgbaSha256);
					if (hold) {
						await new Promise<void>((finish) => { held = { sequence: frame.sequence, finish }; });
					}
					if (destroyed) throw new Error('The captured display closed before presenting its pending frame.');
					frames.push({ windowId, sequence: frame.sequence, rgbaSha256: frame.rgbaSha256 });
				},
			};
		},
	});
	const lifecycle = new FramescaperNativeServicesLifecycleV3({
		queue, roots, watch, scratch, lease: () => lease, now: () => 1_001,
		watchCoordinator: { refreshHints: () => undefined, reconcileNow: async () => undefined },
		externalDisplay,
	});
	const preferences = {
		nativeMediaEnabled: true, hardwareDecodeEnabled: false,
		hardwareEncodeEnabled: false, ofxConsentEnabled: false,
	};
	const controller = new FramescaperNativeServicesControllerV3({
		queue, roots, watch, lifecycle, lease: () => lease, now: () => 1_001,
		runtimeAvailable: () => true, nativeMediaEnabled: () => true, preferences: () => preferences,
		capabilities: () => createNativeMediaCapabilitySnapshotV1({
			masterEnabled: true,
			entries: Object.values(NATIVE_MEDIA_CAPABILITY_IDS).map((entry) => {
				const supported = entry.id === NATIVE_MEDIA_CAPABILITY_IDS.externalDisplay.id;
				return { ...entry, buildSupported: supported, probeSucceeded: supported,
					selfTestPassed: supported, userEnabled: supported };
			}),
		}),
	});
	const handlers = new Map<string, Parameters<FramescaperNativeServicesMainIpcOptions['handle']>[1]>();
	const listeners = new Map<string, (event: unknown, value?: unknown) => void>();
	const registration = registerFramescaperNativeServicesMainIpc({
		handle: (channel: string, handler: Parameters<FramescaperNativeServicesMainIpcOptions['handle']>[1]) => { handlers.set(channel, handler); },
		removeHandler: (channel: string) => { handlers.delete(channel); },
		on: (channel: string, listener: (event: unknown, value?: unknown) => void) => { listeners.set(channel, listener); },
		removeListener: (channel: string) => { listeners.delete(channel); },
		authorizeOwner: () => true, controller,
	});
	const bridge = await loadFramescaperNativeServicesTestBridge(
		(channel, request) => {
			const handler = handlers.get(channel);
			if (!handler) throw new Error(`Missing native IPC channel ${channel}.`);
			return handler({}, request);
		},
		(channel, request, ports) => {
			assert.equal(channel, FRAMESCAPER_EXTERNAL_DISPLAY_FRAME_PORT_CHANNEL);
			assert.equal(ports.length, 2);
			const [control] = ports;
			assert.ok(control instanceof MessagePort);
			const { frame } = request as Readonly<{ frame: FramescaperExternalDisplayFrameMetadata }>;
			const postResult = control.postMessage.bind(control);
			control.postMessage = (packet: unknown) => {
				assert.ok(packet && typeof packet === 'object' && 'type' in packet);
				assert.ok(packet.type === 'result' || packet.type === 'failure');
				settlements.push({ sequence: frame.sequence, outcome: packet.type });
				postResult(packet);
			};
			const listener = listeners.get(channel);
			assert.ok(listener);
			listener({ ports }, request);
		},
	);
	return {
		bridge, controller, frames, settlements,
		arm: () => { holdNext = true; },
		heldSequence: () => held?.sequence ?? null,
		release: () => { const transfer = held; held = null; transfer?.finish(); },
		windowCount: () => windowCount,
		dispose: async () => {
			if (held) { const transfer = held; held = null; transfer.finish(); }
			registration.dispose();
			externalDisplay.dispose();
			await controller.drain();
			database.close();
		},
	};
}
