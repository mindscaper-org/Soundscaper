/* SPDX-License-Identifier: AGPL-3.0-only */
import { app, BrowserWindow, ipcMain, utilityProcess } from 'electron';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AiDenoiseSessions } from '../../desktop/ai-denoise-sessions.ts';
import { createTrustedDesktopIpc } from '../../desktop/main-trusted-ipc.ts';

void app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
async function run() {
	let window;
	const server = createServer((request, response) => {
		const file = request.url === '/worklet.js' ? 'worklet.js' : request.url === '/capture.js' ? 'capture.js' : 'index.html';
		const audio = request.url === '/speech.wav';
		void readFile(audio ? process.env.SCAPE_AI_DENOISE_TEST_AUDIO : join(import.meta.dirname, file)).then(bytes => {
			response.writeHead(200, { 'Content-Type': audio ? 'audio/wav' : file.endsWith('.js') ? 'text/javascript' : 'text/html' }); response.end(bytes);
		}, () => { response.writeHead(500); response.end(); });
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const sessions = new AiDenoiseSessions({
		prepare: async () => {
			const manifest = JSON.parse(await readFile(process.env.SCAPE_AI_DENOISE_TEST_MANIFEST, 'utf8'));
			return { runtimeRoot: process.env.SCAPE_AI_DENOISE_TEST_RUNTIME_ROOT, modelPath: process.env.SCAPE_AI_DENOISE_TEST_MODEL,
				targetId: 'linux-x64', manifest, executionProviders: manifest.targets['linux-x64'].executionProviders };
		},
		spawn: () => utilityProcess.fork(join(import.meta.dirname, 'helper.mjs'), [], { serviceName: 'ai-denoise-test-helper' }),
		sampleRss: pid => { const value = app.getAppMetrics().find(metric => metric.pid === pid); return value ? value.memory.workingSetSize * 1024 : null; },
		onError: error => console.error(error),
	});
	const trusted = createTrustedDesktopIpc({ ipcMain, windowFor: () => window,
		assertDocumentUrl: url => { if (url !== origin + '/') throw new Error('Unexpected diagnostic document.'); } });
	trusted.on('soundscaper:v1:ai-denoise:connect', (event, request) => { void sessions.open(request, event.ports[0], event.sender); });
	trusted.on('denoise-test-result', (_event, value) => {
		console.log('AI_DENOISE_RESULT:' + JSON.stringify(value));
		sessions.dispose(); server.close(); app.exit(value.error ? 1 : 0);
	});
	window = new BrowserWindow({ show: false, webPreferences: { preload: join(import.meta.dirname, 'preload.cjs'),
		contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
	await window.loadURL(origin + '/');
	setTimeout(() => { sessions.dispose(); server.close(); app.exit(2); }, 60_000).unref();
}
