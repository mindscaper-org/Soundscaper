/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bundledSurgeDataArgument, isBundledFactoryLaunch, withBundledPluginFactoryData } from '../desktop/bundled-plugin-factory-data.ts';
import type { NativeChildIsolationLaunchRequest } from '../desktop/native-child-isolation-contract.ts';

test('the factory argument binds one read-only directory and transports Unicode without a generic environment API', () => {
	const grant = { path: '/app/Müsik/Surge Data', kind: 'directory' as const, identity: { dev: 1, ino: 2 } };
	const request = { arguments: [], readOnly: [] } as unknown as NativeChildIsolationLaunchRequest;
	const wrapped = withBundledPluginFactoryData({ launch: (value: NativeChildIsolationLaunchRequest) => value }, grant);
	const actual = wrapped.launch(request);
	assert.deepEqual(actual.readOnly, [grant]);
	assert.equal(isBundledFactoryLaunch(actual, grant), true);
	assert.equal(Buffer.from(bundledSurgeDataArgument(grant).split('=')[1]!, 'hex').toString('utf8'), grant.path);
	assert.equal(isBundledFactoryLaunch({ ...actual, arguments: ['--arbitrary-option'] }, grant), false);
	assert.equal(isBundledFactoryLaunch({ ...actual, readOnly: [{ ...grant, path: '/other' }] }, grant), false);
	assert.equal(isBundledFactoryLaunch(actual, undefined), false);
	assert.equal(withBundledPluginFactoryData(wrapped, undefined), wrapped);
});
