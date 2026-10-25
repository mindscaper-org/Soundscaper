/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { MAXIMUM_INSTALL_ASSET_BYTES } from '../scripts/lib/offline-application-shell.mjs';
import { renderOfflineServiceWorker, validateOfflineShellConfiguration } from '../scripts/lib/offline-service-worker.mjs';
import { shellConfiguration } from './helpers/offline-shell-fixtures.js';

function installConfiguration(byteLength: number) {
	const base = shellConfiguration('a');
	const baseBytes = base.assets.reduce((total, asset) => total + asset.byteLength, 0);
	const extraBytes = byteLength - baseBytes;
	const extras = Array.from({ length: 4 }, (_, index) => ({
		url: `/assets/large-core-${index}.js`,
		byteLength: Math.floor(extraBytes / 4) + (index < extraBytes % 4 ? 1 : 0),
		sha256: 'a'.repeat(64),
	}));
	return shellConfiguration('a', extras, {
		installUrls: [...base.installUrls, ...extras.map(asset => asset.url)].sort(),
	});
}

function validateGeneratedWorker(configuration: ReturnType<typeof installConfiguration>): void {
	runInNewContext(`${renderOfflineServiceWorker(configuration)}\nvalidateOfflineShellConfiguration(OFFLINE_SHELL);`, {
		addEventListener() {},
	});
}

test('the generated worker accepts install bundles through the approved build ceiling', () => {
	for (const bytes of [9 * 1024 * 1024, MAXIMUM_INSTALL_ASSET_BYTES]) {
		const configuration = installConfiguration(bytes);
		assert.doesNotThrow(() => validateOfflineShellConfiguration(configuration));
		assert.doesNotThrow(() => validateGeneratedWorker(configuration));
	}
});

test('the build ceiling remains enforced by the runtime and generated worker', () => {
	const configuration = installConfiguration(MAXIMUM_INSTALL_ASSET_BYTES + 1);
	assert.throws(() => validateOfflineShellConfiguration(configuration), /install byte limit/u);
	assert.throws(() => validateGeneratedWorker(configuration), /install byte limit/u);
});
