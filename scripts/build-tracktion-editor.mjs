/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolve } from 'node:path';

import { buildTracktionEditor } from './lib/tracktion-editor-build.mjs';

await buildTracktionEditor(resolve(import.meta.dirname, '../.desktop-build/tracktion-editor'));
