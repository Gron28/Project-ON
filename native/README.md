# Windows per-application capture

`win32-x64/addon.node` is the experiment's locally built x64 N-API binary, from `@kokapuk/application-loopback` 1.0.2 (MIT). It is **not an upstream prebuilt release**. The corresponding C++ source and `binding.gyp` are preserved in `source`; the pinned npm package integrity is recorded in the root lockfile.

SHA-256: `eaaed1e636d01c8539e1c206ba72898fa25ec140d2908d753976cc12c97a6458`.

Verified load/API exports under pinned Electron 44.5.1 (Node 24.21.0, N-API 10); interactive window enumeration verified separately. Stream capture and clean-machine acceptance are still required. PE machine is AMD64; imports are Windows built-ins (KERNEL32, USER32, GDI32, ole32, MFPlat, MMDevAPI), not a separate VC runtime.

Developer rebuild: obtain the integrity-pinned 1.0.2 npm source, Node addon API 8.5.0, node-gyp, Python, and Visual Studio C++ Build Tools/Windows SDK. Run `npm install` in that package on Windows x64; compare its source to this snapshot. Test the rebuilt binary under the pinned Electron, then update the binary and checksum together. Building is a developer operation, never silently attempted by setup. Windows ARM64 is not supported until a matching binary is built and verified. The original optional npm dependency remains as a provenance/source pin, but runtime loads this checked bundle directly and repair does not remove it.

The Kokapuk fork declares MIT in package metadata but does not ship a separate license notice. The original upstream author notice is retained below. The source snapshot also vendors Microsoft Windows Implementation Libraries headers; see `WIL-LICENSE.txt`. The existing workspace binary was retained, not rebuilt in this change; a reproducible build is not claimed.

MIT License

Copyright (c) 2025 Matin Tat

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
