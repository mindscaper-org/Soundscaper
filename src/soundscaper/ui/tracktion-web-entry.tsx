/* SPDX-License-Identifier: AGPL-3.0-only */

import { createRoot } from 'react-dom/client';

import SoundscaperAudioEditorBootstrap from './SoundscaperAudioEditorBootstrap.tsx';

const element = document.getElementById('root');
if (!element) throw new Error('The Soundscaper editor root is missing.');
createRoot(element).render(<SoundscaperAudioEditorBootstrap />);
