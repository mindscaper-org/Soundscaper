/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import { withSharedDesktopVulkanToolchain } from '../scripts/lib/desktop-assistance-shared-vulkan.ts';

const options = { targetId: 'win-arm64', cacheRoot: '/cache', platform: 'win32', architecture: 'arm64' } as const;

test('Whisper and llama share one pinned Vulkan build until both consumers finish', async () => {
	let calls = 0, work = '';
	const toolchain = { configureArgs: ['-DVulkan_LIBRARY=/pinned/loader'], provenance: { source: 'pinned' } };
	const result = await withSharedDesktopVulkanToolchain(async prepare => {
		const first = await prepare({ ...options, work: '/whisper' });
		await access(work);
		const second = await prepare({ ...options, work: '/llama' });
		assert.equal(first, toolchain);
		assert.equal(second, first);
		await access(work);
		return 'staged';
	}, { prepare: async request => { calls += 1; work = request.work; return toolchain; } });
	assert.equal(result, 'staged');
	assert.equal(calls, 1);
	assert.notEqual(work, '/whisper');
	assert.notEqual(work, '/llama');
	await assert.rejects(access(work), { code: 'ENOENT' });
});

test('concurrent Vulkan consumers share a build and cannot reuse a different target or host', async () => {
	let calls = 0;
	await withSharedDesktopVulkanToolchain(async prepare => {
		const [first, second] = await Promise.all([
			prepare({ ...options, work: '/whisper' }), prepare({ ...options, work: '/llama' }),
		]);
		assert.equal(first, second);
		for (const changed of [{ targetId: 'win-x64' }, { architecture: 'x64' }, { cacheRoot: '/other' }] as const) {
			await assert.rejects(prepare({ ...options, ...changed, work: '/other' }), /identity/u);
		}
	}, { prepare: async () => { calls += 1; return { identity: 'first' }; } });
	assert.equal(calls, 1);
});

test('shared toolchains fail closed and clean up when either compilation or staging fails', async () => {
	for (const failingBuild of [true, false]) {
		let work = '';
		await assert.rejects(withSharedDesktopVulkanToolchain(async prepare => {
			await prepare({ ...options, work: '/engine' });
			throw new Error('staging failed');
		}, { prepare: async request => {
			work = request.work;
			if (failingBuild) throw new Error('Vulkan compilation failed');
			return {};
		} }), failingBuild ? /Vulkan compilation failed/u : /staging failed/u);
		await assert.rejects(access(work), { code: 'ENOENT' });
	}
});

test('separate packaging invocations rebuild Vulkan and a Metal-only invocation never starts it', async () => {
	let calls = 0;
	for (let run = 0; run < 2; run += 1) {
		await withSharedDesktopVulkanToolchain(prepare => prepare({ ...options, work: '/engine' }), {
			prepare: async () => { calls += 1; return {}; },
		});
	}
	await withSharedDesktopVulkanToolchain(async () => 'metal', { prepare: async () => { calls += 1; return {}; } });
	assert.equal(calls, 2);
});
