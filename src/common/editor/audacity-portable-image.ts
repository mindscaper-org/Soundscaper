/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertAudacitySerializedDatabaseHeader } from './aup4-database.js';

/**
 * Finalize an owned image after its format-specific portable-export check has
 * certified and checkpointed it. Browser memory/OPFS staging uses rollback
 * journaling, but Audacity 3 and 4 open projects in WAL mode. Leaving rollback
 * flags makes that switch need an exclusive lock and fail if another reader exists.
 * Only the detached export changes; browser staging keeps its supported mode.
 */
export function finalizeAudacityPortableImage(bytes: Uint8Array): Uint8Array {
	assertAudacitySerializedDatabaseHeader(bytes);
	bytes[18] = 2;
	bytes[19] = 2;
	return bytes;
}
