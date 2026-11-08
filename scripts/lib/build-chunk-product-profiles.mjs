/* SPDX-License-Identifier: AGPL-3.0-only */

/** @type {import('rolldown').CodeSplittingGroup[]} */
export const productProfileChunkGroups = [{
	// Product capabilities, profile selection and project suffix routing form one
	// common metadata role without editor or UI dependencies. Product identities
	// remain with the initial site entry, whose routing reads that leaf directly.
	name: 'product-profiles',
	test: /(?:^|[\\/])src[\\/]common[\\/](?:product-(?:profiles|capabilities)\.js|products\.js|project-file-extensions\.ts)$/,
	priority: 99,
	minSize: 0,
	maxSize: 400_000,
	includeDependenciesRecursively: false,
}];
