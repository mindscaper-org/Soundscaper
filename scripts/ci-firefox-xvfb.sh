#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only

set -euo pipefail
: "${SCAPE_FIREFOX_EXECUTABLE:?The verified Playwright Firefox executable is required.}"

# Playwright launches one browser per worker. Each needs its own X11 focus.
export GDK_BACKEND=x11
exec xvfb-run --auto-servernum --server-args='-screen 0 1920x1200x24' -- "$SCAPE_FIREFOX_EXECUTABLE" "$@"
