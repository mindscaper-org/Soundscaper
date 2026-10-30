/* SPDX-License-Identifier: AGPL-3.0-only */
import { parentPort, workerData } from 'node:worker_threads';
if (!parentPort || typeof workerData !== 'string') throw new Error('A worker module and parent port are required.');
const port = parentPort;
const scope = { onmessage: null as ((event: { data: unknown }) => void) | null,
	postMessage(message: unknown) { port.postMessage(message); } };
Reflect.set(globalThis, 'self', scope);
await import(workerData);
port.on('message', (data: unknown) => { scope.onmessage?.({ data }); });
