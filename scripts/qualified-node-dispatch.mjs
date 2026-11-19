/* SPDX-License-Identifier: AGPL-3.0-only */

// The runner supplies exact absolute entrypoints as a startup hint. The strict
// preload independently validates the selected test and every source artifact.
if (process.env.NODE_TEST_CONTEXT === 'child-v8' && process.argv[1]
	&& process.env.SCAPE_QUALIFIED_NODE_TESTS) {
	const tests = JSON.parse(process.env.SCAPE_QUALIFIED_NODE_TESTS);
	if (!Array.isArray(tests) || tests.some(path => typeof path !== 'string')) {
		throw new TypeError('Qualified Node entrypoints must be an array of absolute test paths.');
	}
	if (tests.includes(process.argv[1])) await import('./qualified-node-preload.ts');
}
