/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeCapturedVideoProxyRequest,
} from '../src/framescaper/editor-captured-video-proxy-request.ts';
import {
	capturedVideoProxySchedulerPolicy,
} from '../src/framescaper/editor-captured-video-proxy-scheduler-state.ts';
import {
	createFramescaperCapturedVideoProxyScheduler as createScheduler,
} from '../src/framescaper/editor-captured-video-proxy-scheduler.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';

type Data = Record<string, unknown>;

const REQUEST: Data = Object.freeze({
	projectId: 'project-1',
	sessionId: 'session-1',
	sourceId: 'video-source',
	expectedProjectRevision: 1,
	expectedContentSha256: 'ab'.repeat(32),
});

function dependencies(): never {
	return {
		schemaVersion: 1,
		profile: PROFILE,
		policy: capturedVideoProxySchedulerPolicy({}),
		port: { database: async () => null },
		opfs: {},
		projectForRelationship: (value: unknown) => value,
		reconcileProjectRequirements: (value: Data) => value.featureRequirements,
		loadAuthoritativeProject: async () => null,
		claimCleanup: { cleanupOperation: async () => ({ status: 'settled' }) },
		synchronizeActiveProject: null,
		quiesceProjectSaves: null,
		session: {
			getSnapshot: () => ({ activeProjectId: null, tabs: [] }),
			captureProjectHistory: () => ({ token: {}, history: {} }),
			assertProjectHistoryToken: () => undefined,
			beginProjectActivation: () => ({ token: {}, release: () => undefined }),
		},
	} as unknown as never;
}

function scheduler(): Data {
	return createScheduler(dependencies()) as unknown as Data;
}

test('a captured proxy request normalizes its identities, revision and digest', () => {
	const normalized = normalizeCapturedVideoProxyRequest(REQUEST as never) as unknown as Data;

	assert.equal(normalized.projectId, 'project-1');
	assert.equal(normalized.sessionId, 'session-1');
	assert.equal(normalized.sourceId, 'video-source');
	assert.equal(normalized.expectedProjectRevision, 1);
	assert.equal(normalized.expectedContentSha256, 'ab'.repeat(32));
});

test('disposal is idempotent and settles cleanly', async () => {
	const schedule = scheduler();
	const dispose = schedule.dispose as () => Promise<void>;

	await assert.doesNotReject(() => dispose());
	await assert.doesNotReject(() => dispose());
});

test('scheduling after disposal is refused as cancelled', async () => {
	const schedule = scheduler();
	await (schedule.dispose as () => Promise<void>)();

	await assert.rejects(
		() => (schedule as unknown as (request: unknown) => Promise<void>)(REQUEST),
		(error: Error) => {
			assert.equal(error.name, 'AbortError');
			assert.match(error.message, /scheduler is disposed/u);
			return true;
		},
	);
});
