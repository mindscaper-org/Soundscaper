/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativePluginScanJobRunner } from '../desktop/native-helper-scan-job.js';
import { createSingleKindHelperWorker } from '../desktop/helper-single-kind-worker.js';
import { MAXIMUM_HELPER_WIRE_MESSAGE_BYTES, validateHelperProcessMessage } from '../desktop/helper-contract.ts';
import { validateHelperPluginScanResult } from '../desktop/plugin-scan-results.ts';
import { validateHelperVampAnalyzerScanResult } from '../desktop/vamp-analyzer-scan-service.ts';
import { admitVampAnalyzerDescriptor } from '../desktop/vamp-analyzer-contract.ts';

function descriptor(index: number) {
	return admitVampAnalyzerDescriptor({ kind: 'analyzer', format: 'vamp', identifier: `org.example.analyzer${String(index)}`,
		name: `Analyzer ${String(index)}`, description: '', maker: 'Example', copyright: '', pluginVersion: 1,
		vampApiVersion: 2, inputDomain: 'time', minimumChannels: 1, maximumChannels: 2,
		preferredStepSize: 512, preferredBlockSize: 1024, parameters: [], programs: [], outputs: [{
			identifier: 'events', name: 'Events', description: '', unit: '', binCount: 1, binNames: [], extents: null,
			quantizeStep: null, sampleType: 'variable-sample-rate', sampleRate: null, hasDuration: false,
		}] });
}

for (const format of ['vst3', 'vamp'] as const) test(`${format} scanner publishes a complete bounded terminal envelope`, async () => {
	const paths = format === 'vamp' ? ['/usr/lib/vamp/analysis-suite.so']
		: Array.from({ length: 200 }, (_, index) => `/usr/lib/vst3/Effect${String(index)}.vst3`);
	const runJob = createNativePluginScanJobRunner({ platform: 'linux', architecture: 'x64', addonPath: '/unused', addonSha256: 'f'.repeat(64),
		hashFile: async (path: string) => ({ byteLength: 4096, sha256: 'a'.repeat(64), identity: { dev: 1, ino: paths.indexOf(path) + 2 } }),
		loadAddon: async () => ({ describe: () => ({ pluginFormats: [format] }), listPluginCandidates: () => paths,
			scanExactLibrary: () => Array.from({ length: 125 }, (_, index) => descriptor(index)),
			inspectPluginCandidate: (path: string) => ({ status: 'ok', stableId: `org.example.effect${String(paths.indexOf(path))}`,
				name: 'Effect', vendor: 'Example', version: '1', classification: 'effect', inputChannels: 2, outputChannels: 2,
				realtime: true, offline: true, reportedLatencyFrames: 0 }) }),
	});
	let resolveTerminal!: (message: unknown) => void; let rejectTerminal!: (error: Error) => void;
	const terminal = new Promise<unknown>((resolve, reject) => { resolveTerminal = resolve; rejectTerminal = reject; });
	const worker = createSingleKindHelperWorker({ kind: 'plugin-scan', runJob,
		post: (message: unknown) => { if ((message as { type: string }).type === 'result') resolveTerminal(message); },
		heartbeatIntervalMs: 1_000_000, exit: () => { rejectTerminal(new Error('worker exited before its terminal result')); },
	});
	try {
		worker.handleMessage({ contractVersion: 1, type: 'job', jobId: 'a'.repeat(40), kind: 'plugin-scan', jobContractVersion: 1,
			grant: { rootPath: '/usr/lib', format, identity: { dev: 1, ino: 2 } },
			resourcePolicy: { maximumInputBytes: 1, maximumJobDurationMs: 300_000, maximumRssBytes: 512 * 1024 ** 2 } });
		const message = validateHelperProcessMessage(await terminal);
		assert.equal(message.type, 'result');
		assert.ok(Buffer.byteLength(JSON.stringify(message)) <= MAXIMUM_HELPER_WIRE_MESSAGE_BYTES);
		if (message.type !== 'result') return;
		if (format === 'vst3') {
			const result = validateHelperPluginScanResult(message.result);
			assert.equal(result.status, 'root-oversized'); assert.ok(result.entries.length > 0 && result.entries.length < 200);
			assert.equal(result.entries[0]?.stableId, 'org.example.effect0');
		} else {
			const result = validateHelperVampAnalyzerScanResult(message.result);
			assert.equal(result.status, 'root-oversized');
			assert.deepEqual(result.libraries, [], 'an oversized library is refused whole, preserving digest-to-catalog identity');
		}
	} finally { worker.dispose(); }
});
