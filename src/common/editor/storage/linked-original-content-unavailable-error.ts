/* SPDX-License-Identifier: AGPL-3.0-only */

/** Positive evidence that an unchanged binding cannot supply its authenticated original. */
export class LinkedOriginalContentUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LinkedOriginalContentUnavailableError';
	}
}
