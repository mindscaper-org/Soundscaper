/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveBrowserProductTestUrl } from './browser-product-test-url.js';

const DIAGNOSTIC_PAGE_SPECS = new Set([
	'audio-editor-longform-editorial-benchmark.spec.js',
	'audio-editor-m4-production-parity.spec.js',
	'audio-editor-m4b2-keyframe-parity.spec.js',
	'audio-editor-video-preview-benchmark.spec.js',
]);

export function usesPackagedRuntimeDiagnosticPage(file) {
	if (typeof file !== 'string') throw new TypeError('Packaged-runtime spec path must be a string.');
	return DIAGNOSTIC_PAGE_SPECS.has(file.split(/[\\/]/u).at(-1));
}

/** Configure the disposable test profile before workflows can close projects. */
export async function preparePackagedRuntimeSavingPreferences(page) {
	await page.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: 'Edit', exact: true }).click();
	await page.getByRole('menu', { name: 'Edit', exact: true })
		.getByRole('menuitem', { name: /^Preferences(?:\s|$)/u }).click();
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /General$/u }).click();
	await preferences.getByRole('group', { name: 'Ask to save projects when closing', exact: true })
		.getByRole('button').click();
	await page.getByRole('option', { name: 'Off', exact: true }).click();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
}

export async function bypassPackagedRuntimeServiceWorker(context, page) {
	const session = await context.newCDPSession(page);
	try {
		await session.send('Network.enable');
		await session.send('Network.setBypassServiceWorker', { bypass: true });
	} catch (error) {
		await session.detach().catch(() => undefined);
		throw error;
	}
	return () => session.detach();
}

export function packagedRuntimeProductBaseURL(productId, environment = process.env) {
	if (!['soundscaper', 'framescaper'].includes(productId)) {
		throw new TypeError('Packaged-runtime product ID is invalid.');
	}
	const path = productId === 'framescaper' ? '/framescaper/' : '/';
	const value = resolveBrowserProductTestUrl(path, environment);
	if (!/^https?:\/\//u.test(value)) {
		throw new Error('Packaged-runtime product origins are required.');
	}
	const url = new URL(value);
	if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
		|| url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new Error('Packaged-runtime product origins must be HTTP 127.0.0.1 roots.');
	}
	return url.href;
}
