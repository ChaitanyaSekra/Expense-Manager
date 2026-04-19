#!/usr/bin/env python3
"""
Generate PWA icons (PNG) from an SVG template.
Run: python generate_icons.py
Requires: pip install cairosvg
"""

import os, sys

try:
    import cairosvg
except ImportError:
    print("cairosvg not found — generating minimal placeholder PNGs instead...")
    cairosvg = None

os.makedirs("icons", exist_ok=True)

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="120" fill="#0f0f11"/>
  <text x="256" y="195" font-family="Georgia,serif" font-size="160"
        font-style="italic" fill="#e8c547" text-anchor="middle">P</text>
  <text x="256" y="340" font-family="Georgia,serif" font-size="90"
        fill="#7a7880" text-anchor="middle" letter-spacing="8">AISA</text>
</svg>"""

if cairosvg:
    for size in [192, 512]:
        cairosvg.svg2png(
            bytestring=SVG.encode(),
            write_to=f"icons/icon-{size}.png",
            output_width=size, output_height=size
        )
        print(f"✅ icons/icon-{size}.png")
else:
    # Write a tiny 1x1 transparent PNG as placeholder
    import struct, zlib, base64

    def minimal_png(size):
        def chunk(tag, data):
            c = struct.pack('>I', len(data)) + tag + data
            return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
        ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
        row  = b'\x00' + b'\xff\xe8\xc5\x47' * size   # gold pixels
        raw  = zlib.compress(row * size)
        return (b'\x89PNG\r\n\x1a\n' +
                chunk(b'IHDR', ihdr) +
                chunk(b'IDAT', raw) +
                chunk(b'IEND', b''))

    for size in [192, 512]:
        with open(f"icons/icon-{size}.png", "wb") as f:
            f.write(minimal_png(size))
        print(f"✅ icons/icon-{size}.png (placeholder)")

print("Done! Run: python server.py")
