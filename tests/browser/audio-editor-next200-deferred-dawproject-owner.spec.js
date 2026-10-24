/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';

for (const transition of ['switch', 'aba', 'same']) test(`cold DAWproject export keeps its requested document: ${transition}`, async ({ page }) => {
	let entered = false, release, moduleUrl;
	const downloads = [];
	page.on('download', download => downloads.push(download));
	const held = new Promise(resolve => { release = resolve; });
	await page.addInitScript(() => { globalThis.__deferredDawExports = []; });
	await page.route(/\/dawproject-service-[^/]+\.js$/u, async route => {
		const response = await route.fetch();
		const body = await response.text();
		const match = body.match(/([\w$]+)\s+as\s+createDawprojectService/u);
		expect(match).not.toBeNull();
		// Observe entry to the real service; preserve all file, PCM and storage work.
		const observed = body.replace(match[0], 'observedDawFactory as createDawprojectService')
			+ `\nconst observedDawFactory=(...args)=>{const service=${match[1]}(...args);return {...service,async saveDawproject(...options){globalThis.__deferredDawExports.push(args[0].getProject()?.id);return await service.saveDawproject(...options);}}};`;
		entered = true; moduleUrl = route.request().url(); await held;
		await route.fulfill({ response, body: observed });
	});
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Outgoing.wav', duration: 1 })]);
	try {
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
		await expect.poll(() => entered).toBe(true);
		if (transition !== 'same') {
			const id = await editor.getAttribute('data-project-id');
			await editor.getByRole('button', { name: 'New project', exact: true }).click();
			await expect(editor).not.toHaveAttribute('data-project-id', id);
			if (transition === 'switch') await importFiles(editor, [createWavFixture({ name: 'Incoming.wav', duration: 1 })]);
			else {
				const tabs = editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab');
				await expect(tabs).toHaveCount(2); await tabs.first().click();
				await expect(editor).toHaveAttribute('data-project-id', id); await waitForProjectActivation(editor);
			}
		}
		release();
		// Await the same real module import, then make a fresh public request.
		await page.evaluate(async url => { await import(url); }, moduleUrl);
		if (transition !== 'same') await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
		await expect.poll(() => downloads.length).toBeGreaterThan(0);
		const entries = unzipSync(await downloadBytes(downloads.at(-1)));
		expect(strFromU8(entries['project.xml'])).toContain(transition === 'switch' ? 'Incoming' : 'Outgoing');
		expect(await page.evaluate(() => globalThis.__deferredDawExports)).toEqual([await editor.getAttribute('data-project-id')]);
	} finally { release(); }
});
