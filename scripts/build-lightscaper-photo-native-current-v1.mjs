#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildLightscaperPhotoNativeCurrentV1 } from './lib/lightscaper-photo-native-build-current-v1.ts';
const { values } = parseArgs({ options: { root: { type: 'string', default: '.' }, target: { type: 'string' }, 'build-root': { type: 'string' }, 'libraw-source': { type: 'string' }, revision: { type: 'string' }, 'working-tree': { type: 'boolean', default: false } }, strict: true });
if (!values.target || !values['build-root'] || !values['libraw-source'] || (values['working-tree'] ? values.revision !== undefined : !values.revision)) throw new TypeError('Supply target, fresh build-root, authenticated libraw-source and revision (or explicit local working-tree).');
const repositoryRoot = resolve(values.root);
await buildLightscaperPhotoNativeCurrentV1({ repositoryRoot, target: values.target, buildRoot: resolve(values['build-root']), librawSourceRoot: resolve(values['libraw-source']), sourceRevision: values['working-tree'] ? null : values.revision ?? null });
console.log(resolve(values['build-root'], 'result'));
