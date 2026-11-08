#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { stageLightscaperPhotoNativeCurrentV1 } from './lib/lightscaper-photo-native-stage-current-v1.ts';
const { values } = parseArgs({ options: { root: { type: 'string', default: '.' }, target: { type: 'string' }, result: { type: 'string' }, runtime: { type: 'string' }, app: { type: 'string' }, 'working-tree': { type: 'boolean', default: false } }, strict: true });
if (!values.target || !values.result || !values.runtime || !values.app) throw new TypeError('Supply target, result, runtime and app directories; pinned WASM must already be staged.');
await stageLightscaperPhotoNativeCurrentV1({ repositoryRoot: resolve(values.root), buildResultRoot: resolve(values.result), runtimeRoot: resolve(values.runtime), applicationRoot: resolve(values.app), target: values.target, allowWorkingTree: values['working-tree'] });
