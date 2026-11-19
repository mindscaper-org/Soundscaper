/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopModuleSpecifiers } from '../scripts/lib/desktop-module-specifiers.ts';
import { assertNoTypeScriptImportSpecifiers } from '../scripts/lib/desktop-staged-import-hygiene.mjs';

test('desktop import admission reads JavaScript syntax and ignores embedded scripts and comments', () => {
	const source = 'const macProbe = \'ObjC.import("Foundation");\';\nObjC.import("Foundation");\n'
		+ 'const python = "from Foundation import NSFileManager";\n'
		+ 'const example = "import value from \'./example.ts\'";\n'
		+ '// import value from "unshipped";\n'
		+ 'import "./present.js"; export { value } from "./owner.js";\n'
		+ 'void import(`./worker.js`); const fs = require("node:fs");';
	assert.deepEqual(desktopModuleSpecifiers(source), ['./present.js', './owner.js', './worker.js', 'node:fs']);
	assert.doesNotThrow(() => assertNoTypeScriptImportSpecifiers('fixture', source));
	for (const source of ['import "./bad.ts";', 'export { value } from "./bad.ts";', 'void import(`./bad.ts`);', 'require("./bad.ts");']) {
		assert.throws(() => assertNoTypeScriptImportSpecifiers('fixture', source), /TypeScript import/u);
	}
});
