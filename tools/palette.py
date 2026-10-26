#!/usr/bin/env python3
"""Извлекает доминирующие цвета из PNG (чистый stdlib, без PIL).
Использование: python3 palette.py picture.png"""
import sys, zlib, struct
from collections import Counter

def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'это не PNG'
    pos, idat, meta = 8, b'', {}
    while pos < len(data):
        length, ctype = struct.unpack('>I4s', data[pos:pos+8])
        chunk = data[pos+8:pos+8+length]
        if ctype == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', chunk[:10])
            meta = dict(w=w, h=h, bd=bd, ct=ct)
        elif ctype == b'IDAT':
            idat += chunk
        elif ctype == b'IEND':
            break
        pos += 12 + length
    return meta, zlib.decompress(idat)

def unfilter(raw, w, h, bpp):
    stride = w * bpp
    out = bytearray(h * stride)
    pos, prev = 0, bytearray(stride)
    for y in range(h):
        f = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos+stride]); pos += stride
        if f == 1:
            for i in range(bpp, stride): line[i] = (line[i] + line[i-bpp]) & 255
        elif f == 2:
            for i in range(stride): line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i-bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i-bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i-bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    return out

meta, raw = read_png(sys.argv[1])
if meta['bd'] != 8 or meta['ct'] not in (2, 6):
    sys.exit(f'не поддерживаю: bit depth={meta["bd"]}, color type={meta["ct"]} (нужен 8-bit RGB/RGBA)')
bpp = 4 if meta['ct'] == 6 else 3
px = unfilter(raw, meta['w'], meta['h'], bpp)
w, h = meta['w'], meta['h']
cnt, total = Counter(), 0
step = max(1, (w*h)//300000)
for i in range(0, w*h, step):
    o = i * bpp
    if bpp == 4 and px[o+3] < 128:
        continue
    cnt[(px[o] & 0xF0, px[o+1] & 0xF0, px[o+2] & 0xF0)] += 1
    total += 1
print(f'размер: {w}x{h}, цветных пикселей: {total}')
for (r, g, b), n in cnt.most_common(16):
    print('#%02X%02X%02X  %5.1f%%' % (r, g, b, 100*n/total))
