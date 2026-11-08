/* SPDX-License-Identifier: AGPL-3.0-only */
import { createContext } from 'react';
import type { PhotoLibraryDebugSoakOwnerCurrentV1 } from '../../../../lightscaper/quality/photo-library-debug-soak-owner-current-v1.ts';
export const PhotoLibraryDebugSoakContextCurrentV1 = createContext<PhotoLibraryDebugSoakOwnerCurrentV1 | null>(null);
