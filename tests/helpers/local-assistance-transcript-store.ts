/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

export class TranscriptStore {
	readonly bodies = new Map<string, Blob>();
	readonly metadata = new Map<string, Readonly<Record<string, unknown>>>();
	beginCount = 0;
	discardCount = 0;
	onCommit: (() => void) | null = null;

	getMediaAssetMetadata(key: string) {
		return Promise.resolve(this.metadata.get(key) ?? null);
	}

	loadMediaAsset(key: string) {
		return Promise.resolve(this.bodies.get(key) ?? null);
	}

	beginMediaAssetWrite(
		key: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{ expectedBytes: number; expectedSha256: string }>,
	) {
		this.beginCount += 1;
		const chunks: Uint8Array[] = [];
		let bytesWritten = 0;
		let aborted = false;
		return Promise.resolve({
			maximumChunkBytes: 64,
			get bytesWritten() { return bytesWritten; },
			write: (bytes: Uint8Array) => {
				if (aborted) throw new Error('writer aborted');
				chunks.push(Uint8Array.from(bytes));
				bytesWritten += bytes.byteLength;
				return Promise.resolve();
			},
			commitOwned: () => {
				const bytes = new Uint8Array(bytesWritten);
				let offset = 0;
				for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
				assert.equal(bytes.byteLength, options.expectedBytes);
				const record = Object.freeze({
					...metadata, sourceId: key, size: bytes.byteLength, sha256: options.expectedSha256,
				});
				const body = new Blob([bytes], { type: String(metadata.mimeType ?? '') });
				this.bodies.set(key, body);
				this.metadata.set(key, record);
				this.onCommit?.();
				return Promise.resolve(Object.freeze({
					metadata: record,
					discardIfCurrent: () => {
						this.discardCount += 1;
						if (this.bodies.get(key) !== body) return Promise.resolve(false);
						this.bodies.delete(key);
						this.metadata.delete(key);
						return Promise.resolve(true);
					},
				}));
			},
			commit: () => Promise.resolve(Object.freeze({})),
			abort: () => { aborted = true; return Promise.resolve(); },
		});
	}
}

