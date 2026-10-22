import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import postcss from 'postcss';

const ROOT = new URL('../', import.meta.url);

test('website owns its token namespace and cannot style editor component classes', async () => {
	const css = await readFile(new URL('src/common/site/site.css', ROOT), 'utf8');
	const root = postcss.parse(css);
	root.walkDecls((declaration) => {
		if (declaration.prop.startsWith('--')) {
			assert.match(declaration.prop, /^--website-/u);
		}
	});
	root.walkRules((rule) => {
		for (const [, name] of rule.selector.matchAll(/(?<![\w-])\.([a-zA-Z][\w-]*)/gu)) {
			assert.match(name, /^website-/u, rule.selector);
		}
	});
});
