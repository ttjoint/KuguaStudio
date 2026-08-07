# -*- coding: utf-8 -*-
"""
图片处理引擎（Python + Pillow）
由 @kugua/module-image 通过子进程调用，负责具体的图片像素级处理。

协议（stdin 传入 JSON，stdout 输出 JSON）：
  stdin  : {"op": "...", "params": {...}, "base64": "...", "path": "...", "images": ["base64", ...]}
  stdout : {"ok": true, "base64": "...", "images": [...], "message": "...", "width": w, "height": h, "format": "png"}
           {"ok": false, "error": "..."}

说明：本引擎严格复刻参考项目 C# ModImages + ImageHandler 的全部图片处理方法，
底层用 Pillow 实现，输入/输出走 base64，支持单帧与 GIF 多帧集合。
"""
import sys
import io
import json
import base64
import math
import random
import traceback

from PIL import Image, ImageOps, ImageDraw, ImageFont

# ---------------- 基础工具 ----------------

def _load_image(data):
    """从请求中读取单张图像，返回 PIL.Image。"""
    if isinstance(data.get("path"), str) and data["path"]:
        with open(data["path"], "rb") as f:
            buf = f.read()
        return Image.open(io.BytesIO(buf))
    if isinstance(data.get("base64"), str) and data["base64"]:
        raw = base64.b64decode(data["base64"])
        return Image.open(io.BytesIO(raw))
    if isinstance(data.get("images"), list) and data["images"]:
        return Image.open(io.BytesIO(base64.b64decode(data["images"][0])))
    raise ValueError("缺少输入图片（base64 或 path）")


def _to_rgba(img):
    """统一转 RGBA，方便保留透明通道。"""
    return img.convert("RGBA")


def _iter_frames(pil_img):
    """把（可能多帧的）图像拆成 RGBA 帧列表 + 每帧时长(毫秒)。"""
    frames = []
    durations = []
    try:
        n = int(getattr(pil_img, "n_frames", 1))
    except Exception:
        n = 1
    for i in range(n):
        pil_img.seek(i)
        frames.append(_to_rgba(pil_img.copy()))
        d = pil_img.info.get("duration", 100)
        durations.append(max(1, int(d)))
    if not frames:
        frames = [_to_rgba(pil_img)]
        durations = [100]
    return frames, durations


def _png_b64(img):
    out = io.BytesIO()
    img.save(out, format="PNG")
    return base64.b64encode(out.getvalue()).decode("ascii")


def _gif_b64(frames, durations):
    out = io.BytesIO()
    frames[0].save(
        out, format="GIF", save_all=True, append_images=frames[1:],
        duration=durations, loop=0, disposal=2,
    )
    return base64.b64encode(out.getvalue()).decode("ascii")


def _finish(img):
    w, h = img.size
    return {"ok": True, "base64": _png_b64(img), "width": w, "height": h, "format": "png"}


def _finish_multi(frames, durations, message="", fmt="gif"):
    """多帧输出：返回 PIL 帧列表，由主分发统一编码。"""
    return {
        "ok": True,
        "images": frames,
        "message": message,
        "format": fmt,
        "_durations": durations,
    }


def _clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def _clamp16(x):
    return 0 if x < 0 else 65535 if x > 65535 else int(x)


def _rgb2yuv(r, g, b):
    """r/g/b 为 0..65535。"""
    y = r * 0.299 + g * 0.587 + b * 0.114
    u = r * -0.168736 + g * -0.331264 + b * 0.5 + 32768
    v = r * 0.5 + g * -0.418688 + b * -0.081312 + 32768
    return [_clamp16(y), _clamp16(u), _clamp16(v)]


def _yuv2rgb(y, u, v):
    r = y + 1.4075 * (v - 32768)
    g = y - 0.3455 * (u - 32768) - 0.7169 * (v - 32768)
    b = y + 1.779 * (u - 32768)
    return [_clamp16(r), _clamp16(g), _clamp16(b)]


def _lcm(a, b):
    return abs(a * b) // math.gcd(a, b) if a and b else 0


def _default_font(size):
    """尝试加载一个可用的中文字体，失败则退回默认字体。"""
    candidates = [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
        "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default()
    except Exception:
        return None


# ---------------- 基础编辑（保留原有） ----------------

def op_rotate(img, params):
    degrees = params.get("degrees", 0)
    return img.rotate(-float(degrees), expand=True, resample=Image.BICUBIC)


def op_flipH(img, params):
    return ImageOps.flip(img)


def op_flipV(img, params):
    return ImageOps.mirror(img)


def op_resize(img, params):
    width = params.get("width")
    height = params.get("height")
    sx = params.get("scaleX")
    sy = params.get("scaleY")
    w, h = img.size
    new_w = int(round(w * (1.0 if sx is None else float(sx))))
    new_h = int(round(h * (1.0 if sy is None else float(sy))))
    if isinstance(width, (int, float)) and float(width) > 0:
        new_w = int(round(float(width)))
    if isinstance(height, (int, float)) and float(height) > 0:
        new_h = int(round(float(height)))
    if new_w <= 0:
        new_w = w
    if new_h <= 0:
        new_h = h
    return img.resize((new_w, new_h), Image.LANCZOS)


def op_cut(img, params):
    top = params.get("top", 0) or 0
    bottom = params.get("bottom", 0) or 0
    left = params.get("left", 0) or 0
    right = params.get("right", 0) or 0
    percent = params.get("percent", False)
    w, h = img.size

    def conv(v):
        if v <= 0:
            return 0
        if percent:
            return int(round(h * float(v)))
        if abs(v) < 1:
            return int(round(h * float(v)))
        return int(round(float(v)))

    t = conv(top) if top > 0 else 0
    b = conv(bottom) if bottom > 0 else 0
    l = conv(left) if left > 0 else 0
    r = conv(right) if right > 0 else 0
    new_w = max(1, w - l - r)
    new_h = max(1, h - t - b)
    return img.crop((l, t, l + new_w, t + new_h))


def op_mirror(img, params):
    mode = int(params.get("mode", 1))
    w, h = img.size
    half_w = w // 2
    half_h = h // 2
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    if mode == 1:
        left = img.crop((0, 0, half_w, h))
        canvas.paste(left, (0, 0))
        canvas.paste(ImageOps.flip(left), (half_w, 0))
    elif mode == 2:
        right = img.crop((half_w, 0, w, h))
        canvas.paste(ImageOps.flip(right), (0, 0))
        canvas.paste(right, (half_w, 0))
    elif mode == 3:
        top = img.crop((0, 0, w, half_h))
        canvas.paste(top, (0, 0))
        canvas.paste(ImageOps.mirror(top), (0, half_h))
    elif mode == 4:
        bottom = img.crop((0, half_h, w, h))
        canvas.paste(ImageOps.mirror(bottom), (0, 0))
        canvas.paste(bottom, (0, half_h))
    else:
        raise ValueError("不支持的镜像模式：%s（应为 1/2/3/4）" % mode)
    return canvas


def op_negate(img, params):
    rgba = _to_rgba(img)
    r, g, b, a = rgba.split()
    inv = ImageOps.invert(Image.merge("RGB", (r, g, b)))
    ir, ig, ib = inv.split()
    return Image.merge("RGBA", (ir, ig, ib, a))


def op_grayscale(img, params):
    gray = img.convert("L")
    return gray.convert("RGBA")


# ---------------- 新增单图处理 ----------------

def op_grid(img, params):
    """网格化：每个像素以 scale 为步长复制到放大画布（参考 setPixelChange1）。"""
    scale = max(1, int(params.get("scale", 2)))
    w, h = img.size
    new = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))
    src = img.load()
    dst = new.load()
    for y in range(h):
        for x in range(w):
            dst[x * scale, y * scale] = src[x, y]
    return new


def op_grid_hole(img, params):
    """网格化2：凡 x%2+y%2==1 的像素扣除（变透明）（参考 setPixelChange2）。"""
    new = _to_rgba(img).copy()
    px = new.load()
    w, h = new.size
    for y in range(h):
        for x in range(w):
            if (x % 2 + y % 2) == 1:
                px[x, y] = (0, 0, 0, 0)
    return new


def op_old_jpg(img, params):
    """做旧：YUV 绿移 + 压损重采样（参考 ImgGreen）。"""
    quality = float(params.get("quality", 0.75))
    quality = _clamp(quality, 0.1, 0.95)
    iterations = int(params.get("iterations", 50 * (1 - quality)))
    frames, dur = _iter_frames(_to_rgba(img))
    out_frames = []
    for frame in frames:
        w, h = frame.size
        if quality < 0.5:
            small_w = max(1, int(round(w * min(1, quality * 1.5))))
            small_h = max(1, int(round(h / w * small_w)))
            frame = frame.resize((small_w, small_h), Image.LANCZOS)
            frame = frame.resize((w, h), Image.LANCZOS)
        rgb = frame.convert("RGB")
        px = rgb.load()
        for y in range(h):
            for x in range(w):
                r, g, b = px[x, y]
                r16, g16, b16 = r * 257, g * 257, b * 257
                for _ in range(iterations):
                    yuv = _rgb2yuv(r16, g16, b16)
                    yuv[1] = yuv[1] - 255
                    r16, g16, b16 = _yuv2rgb(yuv[0], yuv[1], yuv[2])
                px[x, y] = (r16 // 257, g16 // 257, b16 // 257)
        # 压损：多次低质量 JPEG 往返
        for _ in range(iterations):
            buf = io.BytesIO()
            rgb.save(buf, format="JPEG", quality=max(1, int(quality * 90 * random.random())))
            buf.seek(0)
            rgb = Image.open(buf).convert("RGB")
        out_frames.append(rgb.convert("RGBA"))
    if len(out_frames) == 1:
        return out_frames[0]
    return _finish_multi(out_frames, dur)


def op_remove_bg(img, params):
    """抠图：取边缘主色，从四角泛洪将接近背景色区域变透明（参考 ImgRemoveBackground2）。"""
    tolerance = float(params.get("tolerance", 10))
    rgba = _to_rgba(img)
    rgb = rgba.convert("RGB")
    w, h = rgb.size
    color_step = 16
    # 边缘主色统计（量化）
    counts = {}
    line_num = 3

    def add(x, y):
        r, g, b = rgb.getpixel((x, y))
        q = ((r // color_step) * color_step, (g // color_step) * color_step, (b // color_step) * color_step)
        counts[q] = counts.get(q, 0) + 1

    for x in range(w):
        for i in range(line_num):
            add(x, i)
            add(x, h - 1 - i)
    for y in range(line_num, h - line_num):
        for i in range(line_num):
            add(i, y)
            add(w - 1 - i, y)
    top = [c for c, _ in sorted(counts.items(), key=lambda kv: kv[1], reverse=True)][:3]

    rgba_px = rgba.load()
    threshold = tolerance * 4.41  # 近似 ImageMagick fuzz 距离

    def dist2(a, b):
        return sum((x - y) ** 2 for x, y in zip(a, b))

    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    for seed_color in top:
        for sx, sy in corners:
            if rgba_px[sx, sy][3] == 0:
                continue
            stack = [(sx, sy)]
            visited = set()
            base = rgb.getpixel((sx, sy))
            while stack:
                cx, cy = stack.pop()
                if (cx, cy) in visited:
                    continue
                visited.add((cx, cy))
                if dist2(base, seed_color) <= threshold * threshold:
                    rgba_px[cx, cy] = (rgba_px[cx, cy][0], rgba_px[cx, cy][1], rgba_px[cx, cy][2], 0)
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in visited:
                        if dist2(rgb.getpixel((nx, ny)), seed_color) <= threshold * threshold:
                            rgba_px[nx, ny] = (rgba_px[nx, ny][0], rgba_px[nx, ny][1], rgba_px[nx, ny][2], 0)
                            stack.append((nx, ny))
    return rgba


# ---------------- 生成类 ----------------

def op_color_sample(img, params):
    color_code = params.get("color", "#000000")
    size = int(params.get("size", 80))
    try:
        c = color_code.lstrip("#")
        r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
    except Exception:
        r, g, b = 0, 0, 0
    return Image.new("RGBA", (size, size), (r, g, b, 255))


def op_random_pixel(img, params):
    size = int(params.get("size", 100))
    c = Image.new("RGBA", (size, size))
    px = c.load()
    for y in range(size):
        for x in range(size):
            px[x, y] = (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255), 255)
    return c


def op_pixel_words(img, params):
    """像素字：将文字逐字红色绘制到网格（参考 ImgGeneratePixel2）。"""
    text = params.get("text", "") or ""
    if not text:
        raise ValueError("缺少文字 text")
    font_size = int(params.get("fontSize", 12))
    line_max = int(params.get("lineMax", 20))
    line_num = len(text) // line_max
    slide = int(font_size * 0.1)
    width = int(font_size * min(line_max, len(text)) + slide * 2)
    height = int(font_size * (line_num + 1) + slide * 2)
    c = Image.new("RGBA", (max(1, width), max(1, height)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(c)
    font = _default_font(font_size)
    for i, ch in enumerate(text):
        x = int(i % line_max * font_size)
        y = int(i // line_max * font_size)
        draw.text((x, y), ch, fill=(255, 0, 0, 255), font=font)
    return c


def op_captcha(img, params):
    """扭曲：生成 10 帧随机字体/颜色/抖动的验证码 GIF（参考 ImgGenerateCaptcha）。"""
    text = params.get("text", "") or ""
    if not text:
        raise ValueError("缺少文字 text")
    fontsize = 33
    slide = int(fontsize * 0.3)
    line_max = 10
    line_num = len(text) // line_max
    width = int(fontsize * min(line_max, len(text)) + slide * 2)
    height = int(fontsize * (line_num + 1) + slide * 2)
    colors = [
        (0, 0, 0), (255, 0, 0), (255, 255, 0), (0, 255, 0),
        (0, 255, 255), (0, 0, 255), (255, 0, 255),
    ]
    frames = []
    for _ in range(10):
        frame = Image.new("RGBA", (width, height), (255, 255, 255, 0))
        draw = ImageDraw.Draw(frame)
        for i, ch in enumerate(text):
            font = _default_font(fontsize + random.randint(-5, 5))
            x = int(i % line_max * fontsize + random.randint(5, 15) + slide)
            y = int(i // line_max * fontsize + random.randint(-5, 5) + slide)
            draw.text((x, y), ch, fill=random.choice(colors), font=font)
        # 高斯噪声 + 轻度扭曲
        noise = Image.effect_noise((width, height), 20).convert("RGBA")
        frame = Image.blend(frame, noise, 0.35)
        frames.append(frame)
    return _finish_multi(frames, [10] * 10)


def op_cis_color(img, params):
    """CIS：xyY 转 RGB，输出色卡（参考 ColorConvert.xyYtoRGB + GetColorSamples）。"""
    x = float(params.get("x", 0.3127))
    y = float(params.get("y", 0.3290))
    Y = float(params.get("Y", 1.0))
    if y == 0:
        X, Z = 0, 0
    else:
        X = x * Y / y
        Z = (1 - x - y) * Y / y
    m = [
        [3.2404542, -1.5371385, -0.4985314],
        [-0.9692660, 1.8760108, 0.0415560],
        [0.0556434, -0.2040259, 1.0572252],
    ]
    rl = m[0][0] * X + m[0][1] * Y + m[0][2] * Z
    gl = m[1][0] * X + m[1][1] * Y + m[1][2] * Z
    bl = m[2][0] * X + m[2][1] * Y + m[2][2] * Z
    rl, gl, bl = _clamp(rl, 0, 1), _clamp(gl, 0, 1), _clamp(bl, 0, 1)
    r = int(round((rl ** (1 / 2.2)) * 255))
    g = int(round((gl ** (1 / 2.2)) * 255))
    b = int(round((bl ** (1 / 2.2)) * 255))
    size = int(params.get("size", 200))
    c = Image.new("RGBA", (size, size), (r, g, b, 255))
    hexcode = "#%02X%02X%02X" % (r, g, b)
    return {"image": c, "message": "%d,%d,%d(%s)" % (r, g, b, hexcode)}


def op_color_extract(img, params):
    """取色：提取主色并生成色卡条（参考 ImageColorExtract + GetColorSamples）。"""
    count = max(1, int(params.get("count", 3)))
    rgb = _to_rgba(img).convert("RGB")
    q = rgb.quantize(count, method=2)
    palette = q.getpalette()
    colors = []
    for i in range(count):
        r, g, b = palette[i * 3:i * 3 + 3]
        colors.append((r, g, b))
    size = int(params.get("size", 80))
    strip = Image.new("RGBA", (size * count, size), (0, 0, 0, 0))
    hexes = []
    for i, (r, g, b) in enumerate(colors):
        block = Image.new("RGBA", (size, size), (r, g, b, 255))
        strip.paste(block, (i * size, 0))
        hexes.append("#%02X%02X%02X" % (r, g, b))
    return {"image": strip, "message": "   ".join(hexes)}


# ---------------- 幻影坦克 ----------------

def op_hytk(img, params):
    """幻影坦克：两张图叠加（参考 ImageBlend / ImageBlendColorful）。"""
    data_images = params.get("images") or []
    if len(data_images) < 2:
        raise ValueError("幻影坦克需要两张图片")
    front = _to_rgba(Image.open(io.BytesIO(base64.b64decode(data_images[0]))))
    back = _to_rgba(Image.open(io.BytesIO(base64.b64decode(data_images[1]))))
    colorful = bool(params.get("colorful", False))
    w, h = front.size
    if back.size != (w, h):
        back = back.resize((w, h), Image.LANCZOS)
    if colorful:
        return _blend_colorful(front, back)
    return _blend_bw(front, back)


def _blend_bw(front, back):
    w, h = front.size
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    fp = front.load()
    bp = back.load()
    op = out.load()
    for y in range(h):
        for x in range(w):
            fr, fg, fb, _ = fp[x, y]
            br, bg, bb, _ = bp[x, y]
            fr, fg, fb = fr / 255, fg / 255, fb / 255
            br, bg, bb = br / 255, bg / 255, bb / 255
            gray1 = fr * 0.222 + fg * 0.707 + fb * 0.071
            gray2 = (br * 0.222 + bg * 0.707 + bb * 0.071) * 0.3
            a = 1.0 - gray1 + gray2
            r = gray2 / a if a > 1e-8 else 0.0
            r = _clamp(r, 0.0, 1.0)
            a = _clamp(a, 0.0, 1.0)
            op[x, y] = (int(round(r * 255)), int(round(r * 255)), int(round(r * 255)), int(round(a * 255)))
    return out


def _blend_colorful(wimg, bimg):
    w, h = wimg.size
    wlight = 1.0
    blight = 0.35
    wcolor = 0.5
    bcolor = 0.7
    wp = wimg.load()
    bp = bimg.load()
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    grayR, grayG, grayB = 0.334, 0.333, 0.333
    for y in range(h):
        for x in range(w):
            wr, wg, wb, _ = wp[x, y]
            br, bg, bb, _ = bp[x, y]
            wr, wg, wb = wr / 255, wg / 255, wb / 255
            br, bg, bb = br / 255, bg / 255, bb / 255
            wr = wr * wlight
            wg = wg * wlight
            wb = wb * wlight
            br = br * blight
            bg = bg * blight
            bb = bb * blight
            wgray = wr * grayR + wg * grayG + wb * grayB
            keep = 1.0 - wcolor
            wr = wr * wcolor + wgray * keep
            wg = wg * wcolor + wgray * keep
            wb = wb * wcolor + wgray * keep
            bgray = br * grayR + bg * grayG + bb * grayB
            keep2 = 1.0 - bcolor
            br = br * bcolor + bgray * keep2
            bg = bg * bcolor + bgray * keep2
            bb = bb * bcolor + bgray * keep2
            dr = 1.0 - wr + br
            dg = 1.0 - wg + bg
            db = 1.0 - wb + bb
            dgray = dr * 0.222 + dg * 0.707 + db * 0.071
            pr = br / dgray * 255.0 if dgray > 1e-8 else 255.0
            pg = bg / dgray * 255.0 if dgray > 1e-8 else 255.0
            pb = bb / dgray * 255.0 if dgray > 1e-8 else 255.0
            pa = dgray * 255.0
            pr, pg, pb, pa = _clamp(pr, 0, 255), _clamp(pg, 0, 255), _clamp(pb, 0, 255), _clamp(pa, 0, 255)
            op[x, y] = (int(round(pr)), int(round(pg)), int(round(pb)), int(round(pa)))
    return out


# ---------------- 拼接 / GIF 系列 ----------------

def _combine(img1_frames, img2_frames, horizontal):
    """静态/动态拼接（参考 combineImage）。返回 (frames, durations)。"""
    fullframes = _lcm(len(img1_frames), len(img2_frames))
    i1w = max(f.size[0] for f in img1_frames)
    i1h = max(f.size[1] for f in img1_frames)
    i2w = max(f.size[0] for f in img2_frames)
    i2h = max(f.size[1] for f in img2_frames)
    r1, r2 = 1.0, 1.0
    if horizontal:
        if i1h > i2h:
            r2 = float(i1h) / i2h
        elif i1h < i2h:
            r1 = float(i2h) / i1h
    else:
        if i1w > i2w:
            r2 = float(i1w) / i2w
        elif i1w < i2w:
            r1 = float(i2w) / i1w
    i1w, i1h = int(i1w * r1), int(i1h * r1)
    i2w, i2h = int(i2w * r2), int(i2h * r2)
    out_frames = []
    for i in range(fullframes):
        f1 = img1_frames[i % len(img1_frames)].resize((i1w, i1h), Image.LANCZOS)
        f2 = img2_frames[i % len(img2_frames)].resize((i2w, i2h), Image.LANCZOS)
        if horizontal:
            frame = Image.new("RGBA", (i1w + i2w, i1h), (0, 0, 0, 0))
            frame.paste(f1, (0, 0))
            frame.paste(f2, (i1w, 0))
        else:
            frame = Image.new("RGBA", (i1w, i1h + i2h), (0, 0, 0, 0))
            frame.paste(f1, (0, 0))
            frame.paste(f2, (0, i1h))
        out_frames.append(frame)
    return out_frames, [5] * fullframes


def op_combine_h(img, params):
    data_images = params.get("images") or []
    if len(data_images) < 2:
        raise ValueError("竖拼/横拼需要两张（或多张）图片")
    collections = []
    for b in data_images:
        collections.append(_iter_frames(Image.open(io.BytesIO(base64.b64decode(b)))))
    frames, dur = collections[0]
    for coll in collections[1:]:
        frames, dur = _combine(frames, coll[0], True)
    if len(frames) == 1:
        return frames[0]
    return _finish_multi(frames, dur)


def op_combine_v(img, params):
    data_images = params.get("images") or []
    if len(data_images) < 2:
        raise ValueError("竖拼/横拼需要两张（或多张）图片")
    collections = []
    for b in data_images:
        collections.append(_iter_frames(Image.open(io.BytesIO(base64.b64decode(b)))))
    frames, dur = collections[0]
    for coll in collections[1:]:
        frames, dur = _combine(frames, coll[0], False)
    if len(frames) == 1:
        return frames[0]
    return _finish_multi(frames, dur)


def _sprite_sheet(frames, cols):
    """把多帧平铺成一张序列图（参考 GetGifFrames）。"""
    cols = max(1, cols)
    rows = int(math.ceil(len(frames) / cols))
    fw, fh = frames[0].size
    total_w = fw * cols
    total_h = fh * rows
    sheet = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    for row in range(rows):
        for col in range(cols):
            idx = col * rows + row
            if idx < len(frames):
                sheet.paste(frames[idx], (col * fw, row * fh))
    return sheet


def op_gif_sprite(img, params):
    """拆帧：把 gif 各帧平铺成序列图（参考 unzipGifFrameImg + GetGifFrames）。"""
    frames, _ = _iter_frames(img)
    col = int(params.get("col", 1))
    if params.get("row") == "竖":
        col = 1
    elif col == 1:
        col = len(frames)
    sheet = _sprite_sheet(frames, col)
    return {"image": sheet, "message": "一共%d帧" % len(frames)}


def op_gif_unzip(img, params):
    """拆：把 gif 拆成一组 PNG（参考 unzipGif）。"""
    frames, _ = _iter_frames(img)
    return {"images": frames, "message": "一共%d张" % len(frames), "fmt": "png"}


def op_gif_unzip_grid(img, params):
    """拆NxM：把图片拆成 col x row 碎片（参考 unzipImage）。"""
    frames, _ = _iter_frames(img)
    col = max(1, int(params.get("col", 1)))
    row = max(1, int(params.get("row", 1)))
    base = frames[0]
    w, h = base.size
    cw, ch = w // col, h // row
    out = []
    for y in range(row):
        for x in range(col):
            out.append(base.crop((x * cw, y * ch, (x + 1) * cw, (y + 1) * ch)))
    return {"images": out, "message": "一共%d张" % len(out), "fmt": "png"}


def op_gif_remove_frame(img, params):
    """删帧：从 beginFrame 起删掉 sumFrame 帧（参考 removeGifFrame）。"""
    frames, dur = _iter_frames(img)
    begin = int(params.get("begin", 0))
    count = int(params.get("count", 1))
    if begin < 0:
        begin = len(frames) - (abs(begin) % len(frames))
    if count == 0:
        count = 1
    elif count < 0:
        count = abs(count) % len(frames)
        begin = begin - count
    remove_idx = []
    for i in range(len(frames)):
        if i + 1 >= begin:
            remove_idx.append(i)
            if len(remove_idx) > count:
                break
    new_frames = [f for i, f in enumerate(frames) if i not in remove_idx]
    new_dur = [d for i, d in enumerate(dur) if i not in remove_idx]
    if not new_frames:
        new_frames = [frames[0]]
        new_dur = [100]
    if len(new_frames) == 1:
        return new_frames[0]
    return _finish_multi(new_frames, new_dur, "剩余%d帧" % len(new_frames))


def op_gif_zip(img, params):
    """合：多图合成 gif；单图按 row x col 拆分序列帧合成 gif（参考 zipGif）。"""
    data_images = params.get("images") or []
    if len(data_images) >= 2 or (len(data_images) == 1 and params.get("sprite")):
        # 多图 → gif
        frames = []
        minh = 400
        minw = 400
        for b in data_images:
            coll, _ = _iter_frames(Image.open(io.BytesIO(base64.b64decode(b))))
            for f in coll:
                fw, fh = f.size
                if fh < fw:
                    tw = int(round(fw / fh * minh))
                    f = f.resize((tw, minh), Image.LANCZOS)
                else:
                    th = int(round(fh / fw * minw))
                    f = f.resize((minw, th), Image.LANCZOS)
                frames.append(f)
        return _finish_multi(frames, [5] * len(frames), "一共%d帧" % len(frames))
    # 单选序列图 → gif
    if not data_images:
        raise ValueError("缺少输入图片")
    frame = _to_rgba(Image.open(io.BytesIO(base64.b64decode(data_images[0]))))
    row = max(1, int(params.get("row", 1)))
    col = max(1, int(params.get("col", 1)))
    w, h = frame.size
    fw, fh = w // col, h // row
    frames = []
    for r in range(row):
        for c in range(col):
            frames.append(frame.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh)))
    return _finish_multi(frames, [5] * len(frames), "一共%d帧" % len(frames))


def op_gif_shuffle(img, params):
    """乱序：打乱 gif 帧顺序（参考 randGif）。"""
    frames, dur = _iter_frames(img)
    idx = list(range(len(frames)))
    random.shuffle(idx)
    new_frames = [frames[i] for i in idx]
    new_dur = [dur[i] for i in idx]
    if len(new_frames) == 1:
        return new_frames[0]
    return _finish_multi(new_frames, new_dur)


def op_webp_to_gif(img, params):
    """gif：webp 转 gif（多帧）或 png（单帧）（参考 webpToGif）。"""
    pil = img
    if getattr(pil, "n_frames", 1) <= 1:
        return _to_rgba(pil)
    frames, dur = _iter_frames(pil)
    return _finish_multi(frames, dur)


def op_gif_speed(img, params):
    """倍速：调整 gif 播放速率，负数倒放（参考 ImgSetGifSpeed）。"""
    speed = float(params.get("speed", 1.0))
    frames, dur = _iter_frames(img)
    if len(frames) <= 1:
        return frames[0]
    if abs(speed) <= 0.001:
        return frames[0]
    if speed < 0:
        frames = list(reversed(frames))
        dur = list(reversed(dur))
    sp = abs(speed)
    original_sum = sum(dur)
    target_sum = int(original_sum / sp)
    needs_removal = any(d / sp < 2 for d in dur)
    if needs_removal:
        target_count = max(2, int(round(len(frames) / sp)))
        step = int(math.ceil(len(frames) / target_count))
        new_frames = []
        new_dur = []
        for i in range(0, len(frames), step):
            new_frames.append(frames[i])
            new_dur.append(dur[i])
        frames, dur = new_frames, new_dur
        per = max(2, target_sum // len(frames))
        dur = [per] * len(frames)
    else:
        dur = [max(2, int(d / sp)) for d in dur]
    return _finish_multi(frames, dur)


def op_shake(img, params):
    """抖动：生成抖动动画（参考 ImgShake）。"""
    degree = float(params.get("degree", 0.5))
    frames, dur = _iter_frames(img)
    w, h = frames[0].size
    new_w = int(w * (1 + degree / 5.0))
    new_h = int(h * (1 + degree / 5.0))
    out_frames = []
    out_dur = []
    if len(frames) == 1:
        base = frames[0]
        for _ in range(10):
            dx = int(new_w * ((random.random() - 0.5) * degree / 10))
            dy = int(new_h * ((random.random() - 0.5) * degree / 10))
            x = int(new_w / 2 - w / 2 + dx)
            y = int(new_h / 2 - h / 2 + dy)
            canvas = Image.new("RGBA", (new_w, new_h), (255, 255, 255, 0))
            canvas.paste(base, (x, y))
            out_frames.append(canvas)
            out_dur.append(5)
    else:
        for i, base in enumerate(frames):
            dx = int(new_w * ((random.random() - 0.5) * degree / 10))
            dy = int(new_h * ((random.random() - 0.5) * degree / 10))
            x = int(new_w / 2 - w / 2 + dx)
            y = int(new_h / 2 - h / 2 + dy)
            canvas = Image.new("RGBA", (new_w, new_h), (255, 255, 255, 0))
            canvas.paste(base, (x, y))
            out_frames.append(canvas)
            out_dur.append(dur[i])
    return _finish_multi(out_frames, out_dur)


def op_roll(img, params):
    """滚动：沿角度方向滚动环形动画（参考 ImgRoll）。"""
    degree = float(params.get("degree", 0)) * math.pi / 180
    frames, dur = _iter_frames(img)
    w, h = frames[0].size
    frame_count = len(frames) * 1
    if len(frames) == 1:
        frame_count = 10
    dx = int(w * math.cos(degree) / frame_count)
    dy = int(-h * math.sin(degree) / frame_count)
    if dx != 0 and dy != 0:
        lcmx = _lcm(abs(dx), w) // w
        lcmy = _lcm(abs(dy), h) // h
        frame_count *= _lcm(lcmx, lcmy)
    out_frames = []
    out_dur = []
    for i in range(frame_count):
        base = frames[i % len(frames)]
        x = int(i * dx % w)
        y = int(i * dy % h)
        canvas = Image.new("RGBA", (w, h), (255, 255, 255, 0))
        canvas.paste(base, (x, y))
        if x > 0:
            canvas.paste(base, (x - w, y))
        if x < 0:
            canvas.paste(base, (x + w, y))
        if y > 0:
            canvas.paste(base, (x, y - h))
        if y < 0:
            canvas.paste(base, (x, y + h))
        if x > 0 and y > 0:
            canvas.paste(base, (x - w, y - h))
        if x > 0 and y < 0:
            canvas.paste(base, (x - w, y + h))
        if x < 0 and y > 0:
            canvas.paste(base, (x + w, y - h))
        if x < 0 and y < 0:
            canvas.paste(base, (x + w, y + h))
        out_frames.append(canvas)
        out_dur.append(dur[i % len(frames)])
    return _finish_multi(out_frames, out_dur)


def op_touch_ball(img, params):
    """摸摸：弹性压扁回弹动画（参考 ToElasticBounceGif）。"""
    frames, dur = _iter_frames(img)
    w, h = frames[0].size
    scale_x = [1.00, 1.08, 1.18, 1.25, 1.20, 1.10, 0.95, 0.98, 1.00, 1.00]
    scale_y = [1.00, 0.88, 0.70, 0.58, 0.70, 0.92, 1.15, 1.08, 1.02, 1.00]
    delay = [10, 8, 7, 8, 7, 6, 8, 8, 10, 10]
    frame_num = _lcm(len(frames), 10)
    out_frames = []
    out_dur = []
    for i in range(frame_num):
        base = frames[i % len(frames)]
        new_w = int(round(w * scale_x[i % 10]))
        new_h = int(round(h * scale_y[i % 10]))
        scaled = base.resize((max(1, new_w), max(1, new_h)), Image.LANCZOS)
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ox = int((w - scaled.size[0]) / 2)
        oy = int((h - scaled.size[1]) / 2)
        canvas.paste(scaled, (ox, oy))
        out_frames.append(canvas)
        out_dur.append(delay[i % 10])
    return _finish_multi(out_frames, out_dur)


# ---------------- 主分发 ----------------

def _unwrap_result(result):
    """把各 op 返回值规整为 (image | frames/dur | dict)。"""
    if isinstance(result, tuple) and len(result) == 2 and isinstance(result[1], list) and isinstance(result[0], list):
        return result
    return result


OPS = {
    # 基础编辑
    "rotate": {"fn": op_rotate, "input": "single"},
    "flipH": {"fn": op_flipH, "input": "single"},
    "flipV": {"fn": op_flipV, "input": "single"},
    "resize": {"fn": op_resize, "input": "single"},
    "cut": {"fn": op_cut, "input": "single"},
    "mirror": {"fn": op_mirror, "input": "single"},
    "negate": {"fn": op_negate, "input": "single"},
    "grayscale": {"fn": op_grayscale, "input": "single"},
    # 新增单图
    "grid": {"fn": op_grid, "input": "single"},
    "gridHole": {"fn": op_grid_hole, "input": "single"},
    "oldJpg": {"fn": op_old_jpg, "input": "single"},
    "removeBg": {"fn": op_remove_bg, "input": "single"},
    # 生成类
    "colorSample": {"fn": op_color_sample, "input": "none"},
    "randomPixel": {"fn": op_random_pixel, "input": "none"},
    "pixelWords": {"fn": op_pixel_words, "input": "none"},
    "captcha": {"fn": op_captcha, "input": "none"},
    "cisColor": {"fn": op_cis_color, "input": "none"},
    "colorExtract": {"fn": op_color_extract, "input": "single"},
    # 幻影坦克
    "hytk": {"fn": op_hytk, "input": "multi"},
    # 拼接
    "combineH": {"fn": op_combine_h, "input": "multi"},
    "combineV": {"fn": op_combine_v, "input": "multi"},
    # GIF 系列
    "gifSprite": {"fn": op_gif_sprite, "input": "single"},
    "gifUnzip": {"fn": op_gif_unzip, "input": "single"},
    "gifUnzipGrid": {"fn": op_gif_unzip_grid, "input": "single"},
    "gifRemoveFrame": {"fn": op_gif_remove_frame, "input": "single"},
    "gifZip": {"fn": op_gif_zip, "input": "multi"},
    "gifShuffle": {"fn": op_gif_shuffle, "input": "single"},
    "webpToGif": {"fn": op_webp_to_gif, "input": "single"},
    "gifSpeed": {"fn": op_gif_speed, "input": "single"},
    "shake": {"fn": op_shake, "input": "single"},
    "roll": {"fn": op_roll, "input": "single"},
    "touchBall": {"fn": op_touch_ball, "input": "single"},
}


def main():
    raw = sys.stdin.read()
    if not raw.strip():
        print(json.dumps({"ok": False, "error": "空输入"}))
        return
    try:
        data = json.loads(raw)
        op_name = data.get("op", "")
        params = data.get("params", {}) or {}
        if op_name not in OPS:
            print(json.dumps({"ok": False, "error": "未知操作：%s" % op_name}))
            return
        spec = OPS[op_name]
        # 注入多图输入（若 params 已显式携带则不覆盖）
        if spec["input"] == "multi":
            params = dict(params)
            if not params.get("images"):
                params["images"] = data.get("images") or []

        if spec["input"] == "single":
            img = _load_image(data)
            result = spec["fn"](img, params)
        elif spec["input"] == "none":
            result = spec["fn"](None, params)
        else:
            result = spec["fn"](data, params)

        # 统一输出
        if isinstance(result, dict) and "images" in result:
            # 多图输出
            frames = result["images"]
            if frames:
                w, h = frames[0].size
                print(json.dumps({
                    "ok": True,
                    "images": [_png_b64(f) for f in frames],
                    "base64": _gif_b64(frames, [params.get("_dur", 100)] * len(frames)),
                    "width": w, "height": h, "format": result.get("fmt", "gif"),
                    "message": result.get("message", ""),
                }))
            else:
                print(json.dumps({"ok": False, "error": "多图输出为空"}))
            return
        if isinstance(result, dict) and "image" in result:
            w, h = result["image"].size
            print(json.dumps({
                "ok": True,
                "base64": _png_b64(result["image"]),
                "width": w, "height": h, "format": "png",
                "message": result.get("message", ""),
            }))
            return
        if isinstance(result, dict) and "base64" in result:
            print(json.dumps(result))
            return
        if isinstance(result, tuple) and isinstance(result[0], list):
            frames, dur = result
            if frames:
                print(json.dumps(_finish_multi(frames, dur)))
            else:
                print(json.dumps({"ok": False, "error": "帧集合为空"}))
            return
        if isinstance(result, Image.Image):
            print(json.dumps(_finish(result)))
            return
        print(json.dumps({"ok": False, "error": "无法识别的返回类型"}))
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": "%s: %s" % (type(e).__name__, e)}))


if __name__ == "__main__":
    main()