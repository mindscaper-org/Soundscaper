/* SPDX-License-Identifier: AGPL-3.0-only */

export function createFileActionChooser(chooseCommandAction) {
	return async (page, editor, action, options = {}) => {
		await prepareBrowserProjectPicker(page, editor);
		await chooseCommandAction(page, editor, 'File', action, options);
	};
}

/** Make Chromium's native picker observable through Playwright's filechooser event. */
async function prepareBrowserProjectPicker(page, editor) {
	const accept = await editor.locator('[data-aup4-input]').getAttribute('accept');
	await page.evaluate((accept) => {
		const picker = globalThis.showOpenFilePicker;
		// Permission and writable-handle scenarios supply their own picker stubs.
		if (typeof picker !== 'function' || !Function.prototype.toString.call(picker).includes('[native code]')) return;
		Object.defineProperty(globalThis, 'showOpenFilePicker', {
			configurable: true,
			value: ({ multiple = false } = {}) => new Promise((resolve, reject) => {
				const input = document.createElement('input');
				input.type = 'file';
				input.accept = accept ?? '';
				input.multiple = multiple;
				input.hidden = true;
				input.addEventListener('change', () => {
					const files = Array.from(input.files ?? []);
					input.remove();
					resolve(files.map(file => ({ getFile: async () => file })));
				}, { once: true });
				input.addEventListener('cancel', () => {
					input.remove();
					reject(new DOMException('The project picker was cancelled.', 'AbortError'));
				}, { once: true });
				document.body.append(input);
				input.click();
			}),
		});
	}, accept);
}
