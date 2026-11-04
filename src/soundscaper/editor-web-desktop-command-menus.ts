/* SPDX-License-Identifier: AGPL-3.0-only */

import type { exposeWebDesktopCommands as ExposeWebDesktopCommands }
	from '../common/editor/ui/web-desktop-command-menus.ts';

/** Desktop menus already expose their native commands and need no download offers. */
export const exposeWebDesktopCommands: typeof ExposeWebDesktopCommands = (menus) => [...menus];
