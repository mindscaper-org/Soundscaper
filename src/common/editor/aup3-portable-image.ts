/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertAudacitySerializedDatabaseHeader } from './aup4-database.js';

/**
 * Finalize an owned image after prepareAup3PortableExport has certified and
 * checkpointed it. Browser memory/OPFS staging uses rollback journaling, but
 * Audacity 3 opens projects in WAL mode. Leaving rollback flags in the image
 * makes that switch need an exclusive lock and fail if another reader exists.
 * Only the detached export changes; browser staging keeps its supported mode.
 */
export function finalizeAup3PortableImage(bytes: Uint8Array): Uint8Array {
	assertAudacitySerializedDatabaseHeader(bytes);
	bytes[18] = 2;
	bytes[19] = 2;
	return bytes;
}
