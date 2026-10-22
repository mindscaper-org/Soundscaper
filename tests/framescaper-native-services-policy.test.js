/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('Framescaper native services remain beneath family-v1 authority', async () => {
	const security = await json('config/production-security-matrix.json');
	const mediaPayloads = await json('config/framescaper-media-host-payload-manifest.json');
	const openFxPayloads = await json('config/framescaper-openfx-host-payload-manifest.json');

	const helper = security.risks.find(({ id }) => id === 'native-helper-processes');
	assert.ok(helper);
	const nativeControl = security.risks
		.flatMap(({ currentControls }) => currentControls)
		.find(({ id }) => id === 'framescaper-native-services-pathless-bridge');
	assert.equal(nativeControl?.policyAuthority, 'family-v1-active');

	for (const manifest of [mediaPayloads, openFxPayloads]) {
		assert.deepEqual(manifest.payloads, []);
		assert.equal(manifest.targets.length, 5);
		assert.ok(manifest.targets.every(({ status, payload }) => (
			status === 'ci-generated' && payload === null
		)));
	}
	assert.ok(openFxPayloads.targets.every((target) => !Object.hasOwn(target, 'productionReadiness')));
});

async function text(path) {
	return readFile(new URL(path, root), 'utf8');
}

async function json(path) {
	return JSON.parse(await text(path));
}
