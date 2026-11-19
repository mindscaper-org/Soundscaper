/* SPDX-License-Identifier: AGPL-3.0-only */

/** Query implementations share error identity without importing storage engines. */
export class PhotoQueryIndexNotReadyError extends Error {
	readonly code = 'PHOTO_QUERY_INDEX_NOT_READY';
	constructor() { super('The photo query index is not ready; resume its bounded rebuild.'); this.name = 'PhotoQueryIndexNotReadyError'; }
}
