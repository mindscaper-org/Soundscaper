/* SPDX-License-Identifier: AGPL-3.0-only */
/** The application output bound remains a failure after the startup endpoint has been found. */
export class MotionQualificationApplicationOutput {
	#text = '';
	#bytes = 0;
	#failure: Error | undefined;
	readonly #maximumBytes: number;
	constructor(maximumBytes = 1048576) {
		if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 1048576) throw new Error('Invalid application output bound.');
		this.#maximumBytes = maximumBytes;
	}
	append(bytes: Buffer): string {
		if (this.#failure) throw this.#failure;
		this.#bytes += bytes.length;
		if (this.#bytes > this.#maximumBytes) {
			this.#failure = new Error('Packaged application output exceeded its bound.');
			throw this.#failure;
		}
		this.#text += bytes.toString('utf8');
		return this.#text;
	}
}
