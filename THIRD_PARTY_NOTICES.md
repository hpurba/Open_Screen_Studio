# Third-party notices

Open Screen Studio's own source code is licensed under the MIT License. The
optional MP4 export path includes and runs the following separately licensed
third-party software. Those components remain under their upstream licenses;
the Open Screen Studio MIT License does not replace or override them.

## ffmpeg.wasm JavaScript wrapper

- Package: `@ffmpeg/ffmpeg` 0.12.15
- Transitive package: `@ffmpeg/types` 0.12.4
- License: MIT
- Copyright: ffmpeg.wasm contributors, including Jerome Wu
- Release source: <https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15>
- Release archive: <https://github.com/ffmpegwasm/ffmpeg.wasm/archive/refs/tags/v12.15.tar.gz>
- Upstream license: <https://github.com/ffmpegwasm/ffmpeg.wasm/blob/v12.15/LICENSE>

## ffmpeg.wasm single-thread core

- Package: `@ffmpeg/core` 0.12.10
- Files distributed in the extension: `ffmpeg-core.js` and
  `ffmpeg-core.wasm`
- Package-declared license: GNU General Public License, version 2.0 or later
  (`GPL-2.0-or-later`)
- Release: ffmpeg.wasm `v12.15`, which identifies core `v12.10`, commit
  `71aa99d`
- Release source and reproducible build recipes:
  <https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v12.15>
- Release source archive:
  <https://github.com/ffmpegwasm/ffmpeg.wasm/archive/refs/tags/v12.15.tar.gz>
- Exact release description:
  <https://github.com/ffmpegwasm/ffmpeg.wasm/releases/tag/v12.15>
- Core package metadata:
  <https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10>

The release build recipe uses FFmpeg `n5.1.4` with `--enable-gpl` and links
GPL components including x264. Relevant corresponding sources and license
materials are available at:

- FFmpeg `n5.1.4` source:
  <https://github.com/FFmpeg/FFmpeg/tree/n5.1.4>
- FFmpeg `n5.1.4` source archive:
  <https://github.com/FFmpeg/FFmpeg/archive/refs/tags/n5.1.4.tar.gz>
- FFmpeg GPL v2 text:
  <https://github.com/FFmpeg/FFmpeg/blob/n5.1.4/COPYING.GPLv2>
- FFmpeg licensing details:
  <https://github.com/FFmpeg/FFmpeg/blob/n5.1.4/LICENSE.md>
- ffmpeg.wasm x264 fork used by the release build (`4-cores`):
  <https://github.com/ffmpegwasm/x264/tree/4-cores>
- Complete component versions and build flags:
  <https://github.com/ffmpegwasm/ffmpeg.wasm/blob/v12.15/Dockerfile>

The npm lockfile records the exact distributed package versions and integrity
hashes. Anyone redistributing a packaged extension should retain this notice
and confirm that the corresponding-source links remain available, or host an
equivalent source archive alongside that distribution.

