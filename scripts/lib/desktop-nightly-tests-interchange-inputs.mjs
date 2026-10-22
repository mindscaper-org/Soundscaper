/* SPDX-License-Identifier: AGPL-3.0-only */

import { join } from 'node:path';
import { assertRegularFile, readRequiredJson } from './desktop-nightly-tests-staging-filesystem.mjs';

export const NIGHTLY_INTERCHANGE_INPUTS = Object.freeze([
	{ source: 'tests/helpers/interchange-reference.ts', destination: 'tests/helpers/interchange-reference.ts', kind: 'file', label: 'external interchange reader browser support helper' },
	{ source: 'tests/helpers/interchange-top-clip.ts', destination: 'tests/helpers/interchange-top-clip.ts', kind: 'file', label: 'independent OTIO visible-clip reference helper' },
	{ source: 'scripts/lib/interchange-python.mjs', destination: 'scripts/lib/interchange-python.mjs', kind: 'file', label: 'relocatable interchange reference interpreter resolver' },
	{ source: 'vendor/interchange-conformance', destination: 'vendor/interchange-conformance', kind: 'directory', label: 'independent interchange readers, Python, and notices', allowContainedSymlinks: true },
]);

/** An ordinary development provision lacks Python and cannot be shipped as a hermetic runner. */
export async function validateNightlyInterchange(root) {
	const reference = join(root, 'vendor/interchange-conformance');
	const metadata = await readRequiredJson(join(reference, 'python/PYTHON.json'), 'interchange reference Python metadata');
	if (!['install/bin/python3.12', 'install/python.exe'].includes(metadata.python_exe)) {
		throw new Error('Nightly interchange reference Python has an unsupported executable path.');
	}
	for (const path of [
		'.provisioned.json', 'python/licenses/LICENSE.cpython.txt', `python/${metadata.python_exe}`,
		'opentimelineio/__init__.py', 'otio_cmx3600_adapter/cmx_3600.py', 'otio_fcpx_xml_adapter/fcpx_xml.py',
	]) await assertRegularFile(join(reference, path), `interchange reference ${path}`);
}
