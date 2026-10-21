# Retained source input

`ffmpeg-8.1.3.tar.xz` is the unmodified official FFmpeg 8.1.3 source archive.
Original URL, byte count and SHA-256 are pinned in `../mac-sources.lock.json`.
It is retained here because the upstream server has terminated downloads and timed out from native CI runners. Every use still checks the complete pinned digest and size; the same archive and recipe are included in each corresponding source delivery. FFmpeg licensing is in the archive, including `COPYING.LGPLv2.1`; this archive does not inherit the repository build scripts' GPL declaration.
