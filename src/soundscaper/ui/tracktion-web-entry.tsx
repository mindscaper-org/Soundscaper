/* SPDX-License-Identifier: AGPL-3.0-only */

import { createRoot } from 'react-dom/client';

import { createTracktionWebBridge } from '../tracktion-web-bridge.ts';
import { TracktionEditor } from './TracktionEditor.tsx';

const element = document.getElementById('root');
if (!element) throw new Error('The Tracktion editor root is missing.');
const root = createRoot(element);
if (window.crossOriginIsolated) {
	const worker = new Worker(new URL('tracktion-project-worker.js', window.location.href));
	root.render(<TracktionEditor bridge={createTracktionWebBridge(worker)} deviceTransport={false} />);
} else {
	root.render(<main><p role="alert">The Tracktion browser editor requires cross-origin isolation.</p></main>);
}
