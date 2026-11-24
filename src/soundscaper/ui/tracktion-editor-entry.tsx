/* SPDX-License-Identifier: AGPL-3.0-only */

import { createRoot } from 'react-dom/client';

import type { TracktionProjectBridge } from '../tracktion-project-contract.ts';
import { TracktionEditor } from './TracktionEditor.tsx';

const { soundscaperTracktion } = window as Window & { soundscaperTracktion?: TracktionProjectBridge };
const root = document.getElementById('root');
if (!root || !soundscaperTracktion) throw new Error('The Tracktion editor requires its desktop preload.');
createRoot(root).render(<TracktionEditor bridge={soundscaperTracktion} desktopAudioSetup desktopEffects />);
