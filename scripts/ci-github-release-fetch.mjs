/* SPDX-License-Identifier: AGPL-3.0-only */

// Scoped preload for Electron's existing installer and checksum verifier.
import { fetchGithubReleaseAsset } from './lib/ci-github-release-fetch.mjs';
import { configureCiArtifactFetch } from './lib/ci-artifact-fetch.ts';

configureCiArtifactFetch();
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => fetchGithubReleaseAsset(input, init, { fetchImpl: nativeFetch });
