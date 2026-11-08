/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import type { BrowserContext, Locator } from '@playwright/test';
import { test } from './helpers/browser-coverage-fixture.js';
import { motionMaximumQueueProgress, motionMaximumRetryProgress } from '../../desktop/motionscaper-native-maximum-ui.ts';

async function maximumJob(context: BrowserContext, content = '<progress aria-label="Rendered frames" value="32767" max="32768"></progress>') {
	const origin = 'http://127.0.0.1:4455';
	await context.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Maximum progress observation</title>' }));
	const page = await context.newPage(); await page.goto(`${origin}/en/`);
	await page.setContent(`<section aria-label="Maximum render job"><p role="status">Rendering</p>${content}</section>`);
	page.setDefaultTimeout(1000);
	return { page, job: page.getByRole('region', { name: 'Maximum render job', exact: true }) };
}

test('Motion maximum queue progress survives completion removing the counted progressbar', async ({ context }) => {
	const { page, job } = await maximumJob(context);
	const complete = async () => { await page.evaluate(() => {
		document.querySelector('progress')?.remove(); document.querySelector('[role="status"]')!.textContent = 'Completed';
	}); };
	const originalGetByRole = job.getByRole, getByRole = originalGetByRole.bind(job);
	job.getByRole = (role: Parameters<Locator['getByRole']>[0], options: Parameters<Locator['getByRole']>[1]) => {
		const locator = getByRole(role, options);
		if (role === 'progressbar') {
			const count = locator.count.bind(locator);
			locator.count = async () => {
				const found = await count();
				// Commit the real DOM transition between the old count and attribute protocol reads.
				if (found) await complete();
				return found;
			};
		}
		return locator;
	};
	try {
		assert.equal(await motionMaximumQueueProgress(job, 32768), 32767);
		await complete(); assert.equal(await motionMaximumQueueProgress(job, 32768), 32768);
	} finally { job.getByRole = originalGetByRole; }
});

test('Motion maximum queue progress reads real active values and completed bar absence', async ({ context }) => {
	const { page, job } = await maximumJob(context);
	for (const value of [0, 16384, 32768]) {
		await page.getByRole('progressbar', { name: 'Rendered frames', exact: true }).evaluate((element, number) => element.setAttribute('value', String(number)), value);
		assert.equal(await motionMaximumQueueProgress(job, 32768), value);
	}
	await page.getByRole('progressbar').evaluate(element => element.remove());
	assert.equal(await motionMaximumQueueProgress(job, 32768), 0);
	await page.getByRole('status').evaluate(element => { element.textContent = 'Completed'; });
	assert.equal(await motionMaximumQueueProgress(job, 32768), 32768);
});

test('Motion maximum queue progress preserves failure alerts alongside completion', async ({ context }) => {
	const { page, job } = await maximumJob(context, '<p role="alert">Encoder rejected the output</p>');
	await page.getByRole('status').evaluate(element => { element.textContent = 'Completed'; });
	await assert.rejects(motionMaximumQueueProgress(job, 32768), /Encoder rejected the output/u);
});

test('Motion maximum queue progress refuses failed and cancelled jobs without inventing completion', async ({ context }) => {
	const { page, job } = await maximumJob(context);
	await page.getByRole('progressbar').evaluate(element => element.remove());
	for (const status of ['Failed', 'Cancelled']) {
		await page.getByRole('status').evaluate((element, value) => { element.textContent = value; }, status);
		await assert.rejects(motionMaximumQueueProgress(job, 32768), new RegExp(`Maximum index retry ${status}`, 'u'));
	}
});

test('Motion maximum retry observes the cancelled baseline once and refuses cancellation after rendering begins', async ({ context }) => {
	const { page, job } = await maximumJob(context);
	await page.getByRole('progressbar').evaluate(element => element.remove());
	await page.getByRole('status').evaluate(element => { element.textContent = 'Cancelled'; });
	const read = motionMaximumRetryProgress(job, 32768);
	assert.equal(await read(), 0);
	await page.getByRole('status').evaluate(element => { element.textContent = 'Rendering'; });
	await job.evaluate(element => { element.insertAdjacentHTML('beforeend', '<progress aria-label="Rendered frames" value="37" max="32768"></progress>'); });
	assert.equal(await read(), 37);
	await page.getByRole('progressbar').evaluate(element => element.remove());
	await page.getByRole('status').evaluate(element => { element.textContent = 'Cancelled'; });
	await assert.rejects(read(), /Maximum index retry Cancelled/u);
	await assert.rejects(read(), /Maximum index retry Cancelled/u);
});

test('Motion maximum retry baseline refuses an active bar and never suppresses failures or alerts', async ({ context }) => {
	const { page, job } = await maximumJob(context);
	await page.getByRole('status').evaluate(element => { element.textContent = 'Cancelled'; });
	await assert.rejects(motionMaximumRetryProgress(job, 32768)(), /Cancelled baseline must have no active progressbar/u);
	await page.getByRole('progressbar').evaluate(element => element.remove());
	await page.getByRole('status').evaluate(element => { element.textContent = 'Failed'; });
	await assert.rejects(motionMaximumRetryProgress(job, 32768)(), /Maximum index retry Failed/u);
	await page.getByRole('status').evaluate(element => { element.textContent = 'Cancelled'; });
	await job.evaluate(element => { element.insertAdjacentHTML('beforeend', '<p role="alert">Retry destination rejected</p>'); });
	await assert.rejects(motionMaximumRetryProgress(job, 32768)(), /Retry destination rejected/u);
});

test('Motion maximum queue progress refuses missing malformed and out-of-range values', async ({ context }) => {
	const { page, job } = await maximumJob(context);
	for (const value of [null, '', ' ', 'not-a-frame', '1.5', '-1', '32769']) {
		await page.getByRole('progressbar').evaluate((element, number) => {
			if (number === null) element.removeAttribute('value'); else element.setAttribute('value', number);
		}, value);
		await assert.rejects(motionMaximumQueueProgress(job, 32768));
	}
});

test('Motion maximum queue progress refuses ambiguous status or progress ownership', async ({ context }) => {
	const { page, job } = await maximumJob(context);
	await page.getByRole('progressbar').evaluate(element => { element.after(element.cloneNode(true)); });
	await assert.rejects(motionMaximumQueueProgress(job, 32768), /ownership is ambiguous/u);
	await page.getByRole('progressbar').last().evaluate(element => element.remove());
	await page.getByRole('status').evaluate(element => { element.after(element.cloneNode(true)); });
	await assert.rejects(motionMaximumQueueProgress(job, 32768), /ownership is ambiguous/u);
	await page.getByRole('status').evaluateAll(elements => { for (const element of elements) element.remove(); });
	await assert.rejects(motionMaximumQueueProgress(job, 32768), /ownership is ambiguous/u);
});
