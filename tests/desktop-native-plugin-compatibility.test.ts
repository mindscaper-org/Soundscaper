/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { HELPER_JOB_RESOURCE_HARD_LIMITS, normalizeHelperResourcePolicy } from '../desktop/helper-resource-policy.ts';
import { PLUGIN_SCAN_RESOURCE_POLICY } from '../desktop/plugin-scan-service.ts';
import { createSoundscaperProfessionalPluginPeer, type ProfessionalPluginPeerLauncher } from '../desktop/soundscaper-professional-plugin-peer.ts';

test('plugin scans admit the measured Ozone initialization peak within the existing host memory ceiling', () => {
	const measuredOzoneScanPeak = 743_710_720;
	const policy = normalizeHelperResourcePolicy(PLUGIN_SCAN_RESOURCE_POLICY, 'plugin-scan');
	assert.ok(policy.maximumRssBytes >= measuredOzoneScanPeak,
		'scanning the same library must not fail below its measured initialization peak');
	assert.ok(policy.maximumRssBytes <= HELPER_JOB_RESOURCE_HARD_LIMITS['plugin-host'].maximumRssBytes);
	assert.throws(() => normalizeHelperResourcePolicy({
		maximumRssBytes: HELPER_JOB_RESOURCE_HARD_LIMITS['plugin-scan'].maximumRssBytes + 1,
	}, 'plugin-scan'), /lower-only|no greater than/u);
});

for (const format of ['vst2', 'vst3', 'clap'] as const) {
	test(`trusted ${format} requests allocation compatibility only for legacy VST2`, async (context) => {
		const temporary = await mkdtemp(join(tmpdir(), 'plugin-allocation-policy-'));
		context.after(() => rm(temporary, { recursive: true, force: true }));
		const path = join(await realpath(temporary), `effect.${format === 'vst2' ? 'dll' : format}`);
		await writeFile(path, 'candidate');
		const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
		const candidate = { path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
			identity: { dev: metadata.dev, ino: metadata.ino } };
		let request: Parameters<ProfessionalPluginPeerLauncher['launch']>[0] | undefined;
		const peer = createSoundscaperProfessionalPluginPeer({
			peerExecutable: candidate, pluginFormats: [format], runtimeReadExecute: [],
			launcher: { pluginFilesystemAccess: 'user', vst2LowAddressHeap: true,
				launch: async (value) => { request = value; throw new Error('captured launch'); } },
		});
		await assert.rejects(peer.inspectPluginCandidate(path, format, { ...candidate,
			resourcePolicy: normalizeHelperResourcePolicy(undefined, 'plugin-scan') }), /captured launch/u);
		assert.ok(request);
		assert.equal(request.windowsVst2LowAddressHeap, format === 'vst2' ? true : undefined);
		assert.equal(request.readExecute[0]?.path, path, 'the installed plugin stays unchanged');
		assert.equal(await readFile(path, 'utf8'), 'candidate');
	});
}
