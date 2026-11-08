/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { staticRelativeImports } from './helpers/eager-chunk-group-crossings.ts';

void test('a bare package import never turns a following type-only import into a value edge', () => {
	for (const terminator of [';', '']) {
		assert.deepEqual(staticRelativeImports([
			`import { lazy } from 'react'${terminator}`,
			`import type { WorkspaceProps } from './Workspace.tsx'${terminator}`,
			`import { type OtherProps } from './Other.ts'${terminator}`,
			"const Workspace = lazy(() => import('./Workspace.tsx'));",
		].join('\n')), []);
	}
});

void test('a real relative value import after a bare package and type-only import stays visible', () => {
	assert.deepEqual(staticRelativeImports([
		"import React, { lazy } from 'react';",
		"import type { WorkspaceProps } from './Workspace.tsx';",
		"import { type Options, createWorkspace } from './workspace-owner.ts';",
	].join('\n')), ['./workspace-owner.ts']);
});

void test('closed default, namespace and multiline named import clauses retain their value edges', () => {
	assert.deepEqual(staticRelativeImports([
		"import Default from './default.ts';",
		"import * as namespace from './namespace.ts';",
		"import DefaultNamed, { value, type Shape } from './default-named.ts';",
		"import DefaultNamespace, * as otherNamespace from './default-namespace.ts';",
		'import {',
		' type Options,',
		' createOwner as create,',
		'} from "./multiline.ts";',
		"import { type OnlyShape } from './type-only.ts';",
	].join('\n')), ['./default.ts', './namespace.ts', './default-named.ts', './default-namespace.ts', './multiline.ts']);
});
