/* SPDX-License-Identifier: AGPL-3.0-only */

import { createContext } from 'react';
import type { LightscaperPhotoBackendSwitchCurrentV1 } from '../../controller/composition/lightscaper-photo-backend-switch-current-v1.ts';

export const LightscaperPhotoBackendContextCurrentV1 = createContext<LightscaperPhotoBackendSwitchCurrentV1 | null>(null);
