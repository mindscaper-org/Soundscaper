/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import {
	validateFramescaperCaptureArtifactEvidence,
} from '../desktop/framescaper-capture-artifact-smoke.js';
import {
	runFramescaperCaptureArtifactRendererSmoke,
} from '../desktop/framescaper-capture-artifact-renderer-smoke.js';

test('packaged Framescaper capture smoke grants no-device authority and retires it exactly once', async () => {
	const fixture = captureFixture();
	const injectedSmoke = vm.runInNewContext(`(${runFramescaperCaptureArtifactRendererSmoke.toString()})`);

	const result = await injectedSmoke(fixture.scope);

	assert.deepEqual(JSON.parse(JSON.stringify(result)), fixture.expected);
	assert.deepEqual(fixture.calls, [
		'status',
		'grant:1:camera+microphone:null',
		'teardown:1',
		'teardown:1',
	]);
	assert.equal(Object.hasOwn(result.grant, 'grantId'), false,
		'packaged evidence must not disclose the ephemeral grant identifier');
	assert.doesNotThrow(() => validateFramescaperCaptureArtifactEvidence(
		JSON.parse(JSON.stringify(result)),
	));
});

test('packaged Framescaper capture smoke retries teardown after a native IPC failure', async () => {
	const fixture = captureFixture({ failFirstTeardown: true });

	await assert.rejects(
		() => runFramescaperCaptureArtifactRendererSmoke(fixture.scope),
		/capture owner is stale/iu,
	);
	assert.deepEqual(fixture.calls, [
		'status',
		'grant:1:camera+microphone:null',
		'teardown:1',
		'teardown:1',
	]);
});

test('packaged Framescaper capture smoke evidence is a closed, retired control-plane witness', () => {
	const valid = captureFixture().expected;
	assert.deepEqual(validateFramescaperCaptureArtifactEvidence(valid), valid);
	assert.throws(
		() => validateFramescaperCaptureArtifactEvidence({ ...valid, unexpected: true }),
		/unsupported fields|closed/iu,
	);
	assert.throws(
		() => validateFramescaperCaptureArtifactEvidence({
			...valid,
			teardown: { retired: true, retiredAgain: true },
		}),
		/retired.*exactly once|teardown/iu,
	);
});

function captureFixture({ failFirstTeardown = false } = {}) {
	const calls = [];
	let authority = false;
	let teardownCalls = 0;
	const bridge = {
		grant: async (request) => {
			calls.push(`grant:${String(request.generation)}:${request.roles.join('+')}:${String(request.sourceToken)}`);
			authority = true;
			return {
				grantId: 'a'.repeat(32),
				generation: request.generation,
				expiresAtMs: 1_015_000,
				roles: [...request.roles],
			};
		},
		listSources: async () => { throw new Error('No display inventory is required'); },
		status: async () => {
			calls.push('status');
			return {
				version: 1,
				available: true,
				unavailableReason: null,
				selectionMode: 'source-list',
				systemAudio: 'unavailable',
				sourceLimit: 64,
				sourceListTtlMs: 300_000,
				grantTtlMs: 15_000,
			};
		},
		teardown: async (generation) => {
			calls.push(`teardown:${String(generation)}`);
			teardownCalls += 1;
			if (failFirstTeardown && teardownCalls === 1) throw new Error('capture owner is stale');
			if (!authority) return false;
			authority = false;
			return true;
		},
	};
	const expected = {
		preloadBridge: ['grant', 'listSources', 'status', 'teardown'],
		status: {
			version: 1,
			available: true,
			unavailableReason: null,
			selectionMode: 'source-list',
			systemAudio: 'unavailable',
			sourceLimit: 64,
			sourceListTtlMs: 300_000,
			grantTtlMs: 15_000,
		},
		grant: {
			generation: 1,
			expiresAtMs: 1_015_000,
			roles: ['camera', 'microphone'],
			opaqueId: true,
		},
		teardown: { retired: true, retiredAgain: false },
	};
	return {
		calls,
		expected,
		scope: { framescaperCaptureDesktop: { v1: bridge } },
	};
}
