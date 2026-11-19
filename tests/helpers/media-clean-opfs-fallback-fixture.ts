/* SPDX-License-Identifier: AGPL-3.0-only */

export function cleanlyFallingBackOpfs() {
	const files = new Map<string, Blob>();
	let markWriterOpenStarted: (() => void) | undefined;
	let releaseWriterOpen: (() => void) | undefined;
	const writerOpenStarted = new Promise<void>((resolve) => { markWriterOpenStarted = resolve; });
	const writerOpenRelease = new Promise<void>((resolve) => { releaseWriterOpen = resolve; });
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new DOMException('missing', 'NotFoundError');
			if (!files.has(path)) files.set(path, new Blob());
			return {
				async createWritable(): Promise<never> {
					markWriterOpenStarted?.();
					await writerOpenRelease;
					throw new Error('OPFS writer creation fell back cleanly.');
				},
				async getFile() {
					const file = files.get(path);
					if (!file) throw new DOMException('missing', 'NotFoundError');
					return file;
				},
			};
		},
		async removeEntry(path: string) {
			if (!files.delete(path)) throw new DOMException('missing', 'NotFoundError');
		},
		async *entries() {
			for (const path of files.keys()) yield [path, await directory.getFileHandle(path)];
		},
	};
	return {
		directory: directory as unknown as FileSystemDirectoryHandle,
		files,
		writerOpenStarted,
		releaseWriterOpen: () => { releaseWriterOpen?.(); },
	};
}
