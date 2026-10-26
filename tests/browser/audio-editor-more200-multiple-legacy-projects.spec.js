/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { legacyAupFiles } from '../helpers/more200-legacy-aup-file.ts';

test('dropping two legacy projects reports the ambiguity and preserves the open document', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const before = await editor.getAttribute('data-project-id');
	const lane = editor.locator('.audio-editor-track-lane[data-track-lane]').first();
	const bounds = await lane.boundingBox();
	expect(bounds).not.toBeNull();
	const position = { clientX: bounds.x + Math.min(220, bounds.width - 24), clientY: bounds.y + bounds.height / 2 };
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const files = [projectFile, new File([await projectFile.arrayBuffer()], 'Another-project.aup', { type: projectFile.type }), dataFile];
	const payload = await Promise.all(files.map(async file => ({ name: file.name, type: file.type, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) })));
	const transfer = await page.evaluateHandle(inputs => {
		const data = new DataTransfer();
		for (const input of inputs) data.items.add(new File([new Uint8Array(input.bytes)], input.name, { type: input.type }));
		return data;
	}, payload);
	await lane.dispatchEvent('dragover', { dataTransfer: transfer, ...position });
	await lane.dispatchEvent('drop', { dataTransfer: transfer, ...position });
	await expect(editor.getByRole('alert')).toContainText('one legacy Audacity project');
	await expect(editor).toHaveAttribute('data-project-id', before);
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await expect(editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab')).toHaveCount(1);
	await transfer.dispose();
	const retry = await page.evaluateHandle(inputs => {
		const data = new DataTransfer();
		for (const input of [inputs[0], inputs[2]]) data.items.add(new File([new Uint8Array(input.bytes)], input.name, { type: input.type }));
		return data;
	}, payload);
	await lane.dispatchEvent('dragover', { dataTransfer: retry, ...position });
	await lane.dispatchEvent('drop', { dataTransfer: retry, ...position });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor).not.toHaveAttribute('data-project-id', before);
	await retry.dispose();
});
