/* SPDX-License-Identifier: AGPL-3.0-only */
import { rememberBrowserProjectHandle } from './file-save-stream.ts';

interface BrowserProjectHandle {
	getFile(): Promise<File>;
	createWritable?: unknown;
	requestPermission?(options: { mode: 'readwrite' }): Promise<string>;
}
export async function chooseBrowserProjectFiles(scope: Readonly<{
	showOpenFilePicker(options: { multiple: boolean }): Promise<readonly BrowserProjectHandle[]>;
}>): Promise<File[]> {
	try {
		const handles = await scope.showOpenFilePicker({ multiple: false });
		const files: File[] = [];
		for (const handle of handles) {
			const file = await handle.getFile();
			if (typeof handle.createWritable === 'function'
				&& (!handle.requestPermission || await handle.requestPermission({ mode: 'readwrite' }) === 'granted')) {
				rememberBrowserProjectHandle(file, handle);
			}
			files.push(file);
		}
		return files;
	} catch (error) {
		if ((error as { name?: unknown })?.name === 'AbortError') return [];
		throw error;
	}
}
