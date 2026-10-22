/* SPDX-License-Identifier: AGPL-3.0-only */

interface PreparedVideoSaveOptions {
	readonly writeFailure?: Error;
	readonly closeFailure?: Error;
	readonly commitFailure?: Error;
	readonly abortFailure?: Error;
	readonly onCommit?: () => void;
	readonly format?: string;
	readonly desktop?: boolean;
}

export function preparedVideoSaveStream(events: string[], options: PreparedVideoSaveOptions) {
	let written = 0;
	return {
		mode: 'stream' as const,
		async createWritable(exactByteLength: number, sizeMode: string) {
			events.push(`open:${exactByteLength}:${sizeMode}`);
			return new WritableStream<Uint8Array>({
				write(chunk) {
					if (options.writeFailure) throw options.writeFailure;
					written += chunk.byteLength;
					events.push(`write:${chunk.byteLength}`);
				},
				close() {
					if (options.closeFailure) throw options.closeFailure;
					events.push('seal');
				},
			});
		},
		bytesWritten: () => written,
		async commit() {
			events.push('commit');
			options.onCommit?.();
			if (options.commitFailure) throw options.commitFailure;
			return { fileName: `Direct-video.${options.format ?? 'mp4'}`, method: options.desktop ? 'desktop' : 'file-system-access', size: written };
		},
		abort() {
			events.push('abort');
			return options.abortFailure ? Promise.reject(options.abortFailure) : Promise.resolve();
		},
	};
}
