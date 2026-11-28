/* SPDX-License-Identifier: AGPL-3.0-only */

import { useState } from 'react';

import { createTracktionWebBridge } from '../tracktion-web-bridge.ts';
import { TracktionEditor } from './TracktionEditor.tsx';
import './tracktion-editor.css';

export default function SoundscaperAudioEditorBootstrap() {
	if (!window.crossOriginIsolated) {
		return <p role="alert">Soundscaper requires a cross-origin isolated page to run its audio engine.</p>;
	}

	return <SoundscaperWebEditor />;
}

function SoundscaperWebEditor() {
	const [bridge] = useState(() => createTracktionWebBridge(() => new Worker('/tracktion/tracktion-project-worker.js')));
	return <TracktionEditor bridge={bridge} recordingInput={typeof navigator.mediaDevices?.getUserMedia === 'function'} />;
}
