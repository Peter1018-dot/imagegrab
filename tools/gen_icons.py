"""生成 Chrome 扩展所需的多尺寸 PNG 图标（纯标准库，无第三方依赖）。"""

import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "extension", "icons")


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(int(round(lerp(c1[i], c2[i], t))) for i in range(3))


def rounded_rect_sdf(x, y, cx, cy, hw, hh, radius):
    qx = abs(x - cx) - hw + radius
    qy = abs(y - cy) - hh + radius
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - radius


def capsule_sdf(x, y, ax, ay, bx, by, radius):
    px, py = x - ax, y - ay
    vx, vy = bx - ax, by - ay
    denom = vx * vx + vy * vy
    h = 0.0 if denom == 0 else max(0.0, min(1.0, (px * vx + py * vy) / denom))
    return math.hypot(px - vx * h, py - vy * h) - radius


def coverage(dist, softness=1.0):
    return max(0.0, min(1.0, 0.5 - dist / softness))


def render_base(size):
    """返回 size x size 的 RGBA 列表（每个像素 4 个 0-255 值）。"""
    # 以坐标 0..1 归一化绘制，便于各尺寸保持一致
    pixels = bytearray(size * size * 4)
    top = (99, 102, 241)      # #6366f1
    bottom = (168, 85, 247)   # #a855f7
    mid = (124, 58, 237)      # #7c3aed

    # 几何参数（归一化）
    margin = 0.045
    radius = 0.225
    frame_c = 0.5
    frame_half = 0.335
    frame_radius = 0.17
    frame_stroke = 0.042

    shaft_top = (0.5, 0.30)
    shaft_bottom = (0.5, 0.62)
    head_left = (0.355, 0.505)
    head_right = (0.645, 0.505)
    head_join = (0.5, 0.65)
    stroke = 0.043

    for py in range(size):
        for px in range(size):
            x = (px + 0.5) / size
            y = (py + 0.5) / size

            # 背景：斜向渐变 + 轻微中心高光
            t = max(0.0, min(1.0, (x * 0.55 + y * 0.45)))
            if t < 0.55:
                color = mix(top, mid, t / 0.55)
            else:
                color = mix(mid, bottom, (t - 0.55) / 0.45)
            glow = max(0.0, 1.0 - math.hypot(x - 0.28, y - 0.18) / 0.72)
            color = tuple(min(255, int(c + 18 * glow * glow)) for c in color)

            bg_cov = coverage(rounded_rect_sdf(x, y, 0.5, 0.5, 0.5 - margin, 0.5 - margin, radius), 1.4 / size)

            # 圆角外框
            frame_dist = rounded_rect_sdf(x, y, frame_c, frame_c, frame_half, frame_half, frame_radius)
            frame_cov = coverage(abs(frame_dist) - frame_stroke / 2.0, 1.4 / size)

            # 下载箭头（两条斜线 + 竖杆）
            arrow_dist = min(
                capsule_sdf(x, y, shaft_top[0], shaft_top[1], shaft_bottom[0], shaft_bottom[1], stroke / 2.0),
                capsule_sdf(x, y, head_left[0], head_left[1], head_join[0], head_join[1], stroke / 2.0),
                capsule_sdf(x, y, head_right[0], head_right[1], head_join[0], head_join[1], stroke / 2.0),
            )
            arrow_cov = coverage(arrow_dist, 1.4 / size)

            white_cov = max(frame_cov * 0.75, arrow_cov)  # 外框略透明，箭头纯白
            alpha = bg_cov
            if alpha <= 0:
                continue

            r = int(round(color[0] * (1 - white_cov) + 255 * white_cov))
            g = int(round(color[1] * (1 - white_cov) + 255 * white_cov))
            b = int(round(color[2] * (1 - white_cov) + 255 * white_cov))
            a = int(round(255 * alpha))

            i = (py * size + px) * 4
            pixels[i:i + 4] = bytes((r, g, b, a))
    return pixels


def downscale(pixels, src, dst):
    """盒式降采样。"""
    out = bytearray(dst * dst * 4)
    scale = src / dst
    for y in range(dst):
        y0 = int(y * scale)
        y1 = max(y0 + 1, int((y + 1) * scale))
        for x in range(dst):
            x0 = int(x * scale)
            x1 = max(x0 + 1, int((x + 1) * scale))
            rs = gs = bs = as_ = n = 0
            for sy in range(y0, y1):
                row = sy * src
                for sx in range(x0, x1):
                    i = (row + sx) * 4
                    a = pixels[i + 3]
                    rs += pixels[i] * a
                    gs += pixels[i + 1] * a
                    bs += pixels[i + 2] * a
                    as_ += a
                    n += 1
            o = (y * dst + x) * 4
            if as_:
                out[o] = int(round(rs / as_))
                out[o + 1] = int(round(gs / as_))
                out[o + 2] = int(round(bs / as_))
                out[o + 3] = int(round(as_ / n))
    return out


def write_png(path, pixels, size):
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0
        raw.extend(pixels[y * size * 4:(y + 1) * size * 4])

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    master_size = 512
    master = render_base(master_size)
    for target in (16, 32, 48, 128):
        scaled = downscale(master, master_size, target)
        write_png(os.path.join(OUT_DIR, f"icon{target}.png"), scaled, target)
        print("written", target)


if __name__ == "__main__":
    main()
