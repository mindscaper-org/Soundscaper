/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BrowserContext, Locator } from '@playwright/test';
import { test } from './helpers/browser-coverage-fixture.js';
import { build } from 'esbuild';
import { verifyMotionSustainedBrowserVideo } from '../../scripts/performance/motionscaper-sustained-browser-reference.ts';
import { motionSustainedRenderProgress } from '../../scripts/performance/motionscaper-sustained-ui.ts';

import { authoredWildcardResponseHeaders } from '../../scripts/lib/static-response-headers.mjs';

const origin = 'http://127.0.0.1:4454';
async function oracleBundle() {
	const result = await build({ entryPoints: [resolve('scripts/performance/motionscaper-sustained-webm.ts')],
		bundle: true, write: false, format: 'iife', globalName: 'MotionSustainedVerification', platform: 'browser',
		tsconfigRaw: { compilerOptions: { alwaysStrict: true } } });
	assert.equal(result.outputFiles.length, 1);
	const content = result.outputFiles[0]!.text;
	assert.match(content, /^"use strict";\s+var MotionSustainedVerification =/u);
	return content;
}
async function originContext(context: BrowserContext) {
	await context.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', headers: authoredWildcardResponseHeaders(), body: '<!doctype html><title>Motion oracle scope</title>' }));
	const page = await context.newPage(); await page.goto(`${origin}/en/`); return page;
}

async function renderProgressDialog(context: BrowserContext, content = '<progress aria-label="Rendered frames" value="299" max="300"></progress>') {
	const page = await originContext(context);
	await page.setContent(`<section role="dialog" aria-label="Render Composition"><p role="status">Working…</p>${content}</section>`);
	page.setDefaultTimeout(1000);
	return { page, dialog: page.getByRole('dialog', { name: 'Render Composition', exact: true }) };
}

test('Motion sustained render progress survives completion replacing the counted bar', async ({ context }) => {
	const { page, dialog } = await renderProgressDialog(context);
	const complete = async () => { await page.evaluate(() => {
		document.querySelector('progress')?.remove(); document.querySelector('[role="status"]')!.textContent = 'Render complete';
	}); };
	const originalGetByRole = dialog.getByRole;
	const getByRole = originalGetByRole.bind(dialog);
	dialog.getByRole = (role: Parameters<Locator['getByRole']>[0], options: Parameters<Locator['getByRole']>[1]) => {
		const locator = getByRole(role, options);
		if (role === 'progressbar') {
			const count = locator.count.bind(locator);
			locator.count = async () => {
				const found = await count();
				// Commit the real DOM completion between the old count and attribute protocol reads.
				if (found) await complete();
				return found;
			};
		}
		return locator;
	};
	try {
		assert.equal(await motionSustainedRenderProgress(dialog, 300), 299);
		await complete(); assert.equal(await motionSustainedRenderProgress(dialog, 300), 300);
	} finally { dialog.getByRole = originalGetByRole; }
});

test('Motion sustained render progress observes active values and initial and completed bar absence', async ({ context }) => {
	const { page, dialog } = await renderProgressDialog(context);
	for (const value of [0, 157, 300]) {
		await page.getByRole('progressbar', { name: 'Rendered frames', exact: true }).evaluate((element, number) => element.setAttribute('value', String(number)), value);
		assert.equal(await motionSustainedRenderProgress(dialog, 300), value);
	}
	await page.getByRole('progressbar').evaluate(element => element.remove());
	assert.equal(await motionSustainedRenderProgress(dialog, 300), 0);
	await page.getByRole('status').evaluate(element => { element.textContent = 'Render complete'; });
	assert.equal(await motionSustainedRenderProgress(dialog, 300), 300);
});

test('Motion sustained render progress preserves an alert even alongside completion', async ({ context }) => {
	const { page, dialog } = await renderProgressDialog(context, '<p role="alert">Encoder rejected the output</p>');
	await page.getByRole('status').evaluate(element => { element.textContent = 'Render complete'; });
	await assert.rejects(motionSustainedRenderProgress(dialog, 300), /Encoder rejected the output/u);
});

test('Motion sustained render progress rejects missing malformed and out-of-range values', async ({ context }) => {
	const { page, dialog } = await renderProgressDialog(context);
	for (const value of [null, '', ' ', 'not-a-frame', '1.5', '-1', '301']) {
		await page.getByRole('progressbar').evaluate((element, number) => {
			if (number === null) element.removeAttribute('value'); else element.setAttribute('value', number);
		}, value);
		await assert.rejects(motionSustainedRenderProgress(dialog, 300));
	}
});

test('Motion sustained render progress refuses ambiguous status or progress ownership', async ({ context }) => {
	const { page, dialog } = await renderProgressDialog(context);
	await page.getByRole('progressbar').evaluate(element => { element.after(element.cloneNode(true)); });
	await assert.rejects(motionSustainedRenderProgress(dialog, 300));
	await page.getByRole('progressbar').last().evaluate(element => element.remove());
	await page.getByRole('status').evaluate(element => { element.after(element.cloneNode(true)); });
	await assert.rejects(motionSustainedRenderProgress(dialog, 300));
});

test('Motion sustained actual strict oracle requires document script scope to publish its export', async ({ context }) => {
	const bundle = await oracleBundle(), page = await originContext(context);
	await page.evaluate(bundle);
	assert.equal(await page.evaluate(() => Reflect.has(globalThis, 'MotionSustainedVerification')), false);
	await page.addScriptTag({ content: bundle });
	assert.equal(await page.evaluate(() => {
		const value: unknown = Reflect.get(globalThis, 'MotionSustainedVerification');
		return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'verifyMotionSustainedWebm') === 'function';
	}), true);
});

test('Motion sustained separate reference page reaches the real oracle refusal and closes on failure', async ({ context, browserName }) => {
	test.skip(browserName !== 'chromium', 'The sustained Chromium duration profile requires an actual OPFS destination; other engines retain the script-scope control.');
	const bundle = await oracleBundle(), directory = await mkdtemp(join(tmpdir(), 'motion-oracle-scope-'));
	try {
		const page = await originContext(context);
		await page.evaluate(async () => {
			const root = await navigator.storage.getDirectory(), owned = await root.getDirectoryHandle('motion-oracle-test', { create: true });
			const file = await owned.getFileHandle('empty.webm', { create: true }), writer = await file.createWritable(); await writer.close();
		});
		const outputPath = join(directory, 'reference.json');
		await assert.rejects(verifyMotionSustainedBrowserVideo({ context }, { url: `${origin}/en/`, bundle,
			directoryName: 'motion-oracle-test', fileName: 'empty.webm', frames: 300, references: [], outputPath,
			transfer: { byteLength: 0, sha256: '0'.repeat(64) } }), /WebM reference admission differs\./u);
		assert.deepEqual(context.pages(), [page], 'The failed separate oracle page must close.');
		await assert.rejects(stat(outputPath), { code: 'ENOENT' });
		await page.evaluate(async () => { await (await navigator.storage.getDirectory()).removeEntry('motion-oracle-test', { recursive: true }); });
	} finally { await rm(directory, { recursive: true, force: true }); }
});
