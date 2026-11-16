# EBU EAR speaker renderer

Soundscaper uses unmodified EBU `libear` 0.9.0, revision
`2db69f8fcea0bc5db8a78e14a9c2ae6ed4283c15`, under Apache-2.0.
Copyright 2019 The libear Authors. Upstream:
<https://github.com/ebu/libear/tree/2db69f8fcea0bc5db8a78e14a9c2ae6ed4283c15>.

The gain calculators implement Recommendation ITU-R BS.2127. Soundscaper's
AGPL-3.0-only C ABI wrapper and TypeScript adapters support its existing static
polar point objects and DirectSpeakers beds. They reorder the output into the
application's declared speaker order and apply the gains to audio in a worker.
This is speaker rendering, without BEAR/HRTF data, a Dolby codec, certification,
HOA authoring, diffuse objects, extent or moving-object metadata.

Build dependencies retained in `licenses/`:

- Eigen revision `3147391d946bb4b6c68edd901f2add6ac1f31f8c`: MPL-2.0 and the
  accompanying upstream notices. Only MPL-compatible headers are used.
- xsimd revision `c1247bffa8fc36de7380a5cd42673a3b32f74c97`: BSD-3-Clause.
- Boost 1.92.0: BSL-1.0; headers are compiled into the module.
- Emscripten 3.1.64, compiler-rt, musl, libc++ and libc++abi: the canonical
  license copies are in `../staffpad/licenses/` and included in the combined
  `THIRD_PARTY_NOTICES.txt` asset shipped with the renderer.

`source-manifest.json` pins complete upstream source archives, wrapper sources,
license files, the compiled module, host imports, exports and memory geometry.
`npm run build:ear -- --output /tmp/ear.wasm` downloads the verified archives
and reproduces the artifact using the digest-pinned Emscripten container. It
requires Docker, tar, network access for uncached inputs and at most 6 GiB of
container RAM. `npm run audit:ear` verifies the checked-in deliverable.

The complete corresponding source consists of the wrapper and adapters in this
repository and the exact source archives in the manifest. Eigen's used headers
are unmodified and available in that pinned archive under their original terms.
