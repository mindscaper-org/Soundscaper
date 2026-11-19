/* SPDX-License-Identifier: AGPL-3.0-only */

/** The owning Query2 entrypoint remains fixed while its bounded algorithm is
 * shared privately with the independently persisted/signed legacy profile. */
export { readLightscaperNativeStackQueryInTransactionCurrentV1,
	type LightscaperNativeStackQueryProgressCurrentV1, type LightscaperNativeStackQueryResultCurrentV1,
	type LightscaperNativeStackQueryDestinationCurrentV1 } from './lightscaper-native-stack-query-kernel-shared-current-v1.ts';
