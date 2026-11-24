/* SPDX-License-Identifier: AGPL-3.0-only */

import { once } from 'node:events';
import { resolve } from 'node:path';

import { createTracktionWebServer, loadTracktionWebAssets } from './lib/tracktion-web-static.mjs';

const port = Number(process.argv[2] ?? '4197');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a port from 1 through 65535.');
const assets = await loadTracktionWebAssets(resolve(import.meta.dirname, '../.native-build/tracktion-wasm-core'));
assets.set('/', assets.get('/index.html'));
const server = createTracktionWebServer(assets);
server.listen(port, '127.0.0.1');
await once(server, 'listening');
console.log(`Soundscaper Tracktion is running at http://127.0.0.1:${String(port)}/`);
