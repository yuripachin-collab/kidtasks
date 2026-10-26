#!/usr/bin/env python3
"""Генерирует иконки KidTasks (PNG, чистый stdlib): изумрудный фон + белая галочка.
Использование: python3 make_icon.py 512 assets/icons/icon-512.png"""
import sys, zlib, struct, math

def make_icon(size):
    # полный квадрат (maskable-иконка должна быть полноформатной), внутри — белая галочка
    pts = [(0.30, 0.53), (0.45, 0.68), (0.72, 0.36)]
    w = 0.085  # полутолщина линии в ДОЛЯХ стороны (не в пикселях!)

    def dist_to_seg(px, py, a, b):
        ax, ay = a; bx, by = b
        vx, vy = bx - ax, by - ay
        wx, wy = px - ax, py - ay
        t = max(0.0, min(1.0, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
        dx, dy = px - (ax + t * vx), py - (ay + t * vy)
        return math.hypot(dx, dy)

    bg = (16, 160, 112)   # #10A070
    fg = (255, 255, 255)
    rows = []
    for y in range(size):
        row = bytearray([0])  # фильтр 0
        for x in range(size):
            nx, ny = x / size, y / size
            d = min(dist_to_seg(nx, ny, pts[0], pts[1]), dist_to_seg(nx, ny, pts[1], pts[2]))
            col = fg if d <= w else bg
            row += bytes(col)
        rows.append(bytes(row))
    return bytes().join(rows)

def write_png(path, size, raw):
    def chunk(ctype, data):
        c = struct.pack('>I', len(data)) + ctype + data
        return c + struct.pack('>I', zlib.crc32(ctype + data) & 0xFFFFFFFF)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', ihdr)
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    open(path, 'wb').write(png)

if __name__ == '__main__':
    size = int(sys.argv[1]); out = sys.argv[2]
    write_png(out, size, make_icon(size))
    print('ok:', out, size)
