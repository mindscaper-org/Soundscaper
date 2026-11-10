/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { HelperSupervisionError, type HelperJobRequest } from '../../desktop/helper-supervisor.ts';
import type { NativeAddonAvailability } from '../../desktop/native-addon-payload.ts';
import { DesktopPluginScanService, type PluginScanOutcome, type PluginScanQuarantineReason,
	type PluginScanRootLocation } from '../../desktop/plugin-scan-service.ts';

export const AVAILABLE_PAYLOAD: NativeAddonAvailability = Object.freeze({
	status: 'available',
	descriptor: Object.freeze({
		target: 'linux-x64',
		path: '/verified/soundscaper_helper.node',
		byteLength: 1,
		sha256: 'a'.repeat(64),
		addonVersion: '1.0.0',
		napiVersion: 8,
		toolchainIdentity: 'cc (test) 1.0',
	}),
});

export const ROOT: PluginScanRootLocation = Object.freeze({
	path: '/home/scanner/.vst3',
	identity: Object.freeze({ dev: 66_305, ino: 4_242 }),
	scanDigest: 'e'.repeat(64),
});

export const ENTRY = Object.freeze({
	stableId: 'com.example.reverb',
	name: 'Example Reverb',
	vendor: 'Example Audio',
	version: '2.1.0',
	binaryPath: '/home/scanner/.vst3/Example Reverb.vst3',
	binaryBytes: 4_194_304,
	binarySha256: 'b'.repeat(64),
	classification: 'effect',
	channelSupport: [{ inputs: 2, outputs: 2 }],
	realtime: true,
	offline: true,
	reportedLatencyFrames: 0,
	compatibility: 'compatible',
	descriptorVersion: 3,
});

export const SCAN = Object.freeze({ format: 'vst3', status: 'scanned', detail: '', entries: [ENTRY] });

export function failed(outcome: PluginScanOutcome): Extract<PluginScanOutcome, { status: 'failed' }> {
	assert.equal(outcome.status, 'failed');
	if (outcome.status !== 'failed') throw new Error('unreachable');
	return outcome;
}

interface Harness {
	readonly service: DesktopPluginScanService;
	readonly requests: HelperJobRequest<'plugin-scan'>[];
	readonly quarantined: [string, PluginScanQuarantineReason][];
	readonly disposals: number[];
	/** Mutable so a test can withdraw consent mid-flight, as a user can. */
	readonly grants: Set<string>;
}

export function createService({
	enabled = true,
	quarantined = false,
	consented = ['vst3', 'clap'] as readonly string[],
	digests = [] as readonly string[],
	root = ROOT as PluginScanRootLocation | null,
	payload = AVAILABLE_PAYLOAD,
	describePayload,
	run = async (request: HelperJobRequest<'plugin-scan'>) => ({ ...SCAN, format: request.grant.format }) as unknown,
}: Partial<{
	enabled: boolean;
	quarantined: boolean;
	consented: readonly string[];
	digests: readonly string[];
	root: PluginScanRootLocation | null;
	payload: NativeAddonAvailability;
	describePayload: () => Promise<NativeAddonAvailability>;
	run: (request: HelperJobRequest<'plugin-scan'>) => Promise<unknown>;
}> = {}): Harness {
	const requests: HelperJobRequest<'plugin-scan'>[] = [];
	const quarantines: [string, PluginScanQuarantineReason][] = [];
	const disposals: number[] = [];
	const grants = new Set(consented);
	const service = new DesktopPluginScanService({
		supervisor: {
			runJob: async (request) => {
				requests.push(request);
				request.signal?.throwIfAborted();
				const result = await run(request);
				if (!request.validateResult) return result;
				try {
					return request.validateResult(result);
				} catch (error) {
					// HelperSupervisor never rethrows the contract error from a
					// rejected result: it kills the channel and reports a typed
					// supervision fault. A double that leaks the raw error would
					// let the service pass against a supervisor that does not exist.
					throw new HelperSupervisionError('malformed-message',
						`The helper returned a result the contract rejects: ${(error as Error).message}`);
				}
			},
			snapshot: () => Object.freeze({ state: 'ready', quarantined }),
			clearQuarantine: () => disposals.push(-1),
			dispose: () => disposals.push(1),
		},
		consent: { isGranted: (format) => grants.has(format) },
		quarantine: {
			isQuarantined: (digest) => digests.includes(digest),
			quarantine: (digest, reason) => quarantines.push([digest, reason]),
		},
		roots: { resolve: (rootId) => (rootId === 'root-1' ? root : null) },
		isEnabled: () => enabled,
		describePayload: describePayload ?? (async () => payload),
	});
	return { service, requests, quarantined: quarantines, disposals, grants };
}

