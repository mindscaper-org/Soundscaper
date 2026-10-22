/* SPDX-License-Identifier: AGPL-3.0-only */
/** Structural Node model only: this is never a native directory witness. */
export function createVideoStorageOpfsModel(files: Map<string, { blob: Blob }>, { onWrite = () => undefined }: Readonly<{ onWrite?: () => void }> = {}) {
	return {
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new Error('missing');
			if (!files.has(path)) files.set(path, { blob: new Blob() });
			const entry = files.get(path)!;
			return {
				async createWritable() {
					const parts: BlobPart[] = [];
					return {
						async write(part: BlobPart) { parts.push(part); onWrite(); },
						async close() { entry.blob = new Blob(parts); },
						async abort() { parts.length = 0; },
					};
				},
				async getFile() { return entry.blob; },
			};
		},
		async removeEntry(path: string) { if (!files.delete(path)) throw new Error('missing'); },
	};
}
/** Both paths must preserve true Blob bytes despite malicious public readers. */
export class LyingBlob extends Blob {
	readonly #lie: Blob;
	constructor(actual: string, lie: string, options: BlobPropertyBag) {
		super([actual], options); this.#lie = new Blob([lie], options);
		if (this.#lie.size !== this.size) throw new Error('Adversarial Blob contents must have equal sizes.');
	}
	override slice(start = 0, end = this.size, type = ''): Blob { return this.#lie.slice(start, end, type); }
	override arrayBuffer(): Promise<ArrayBuffer> { return this.#lie.arrayBuffer(); }
}
