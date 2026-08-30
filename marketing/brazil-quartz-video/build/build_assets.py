from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

W, H = 1080, 1920
FONT = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
PURPLE = (58, 30, 72)
PURPLE_A = (58, 30, 72, 215)
GOLD = (212, 175, 110)
WHITE = (255, 255, 255)
os.makedirs("assets", exist_ok=True)

def font(sz):
    return ImageFont.truetype(FONT, sz)

def text_w(d, t, f):
    b = d.textbbox((0, 0), t, font=f)
    return b[2] - b[0], b[3] - b[1]

def center_text(d, y, t, f, fill, tracking=0):
    w, h = text_w(d, t, f)
    d.text(((W - w) / 2, y), t, font=f, fill=fill)
    return h

# ---------- intro title overlay (transparent) ----------
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
# gradient scrim at top for legibility
scrim = Image.new("L", (1, 700), 0)
for y in range(700):
    scrim.putpixel((0, y), int(190 * max(0, 1 - y / 700) ** 1.2))
scrim = scrim.resize((W, 700))
black = Image.new("RGBA", (W, 700), (20, 8, 26, 255))
img.paste(black, (0, 0), scrim)
d = ImageDraw.Draw(img)
d.text((80, 150), "—  东 海 水 晶 原 石 批 发", font=font(38), fill=GOLD)
d.text((80, 230), "巴西水晶原石", font=font(120), fill=WHITE)
d.text((80, 380), "产地直采 · 品质一流", font=font(52), fill=(235, 225, 240))
img.save("assets/intro_title.png")

# ---------- caption bars ----------
caps = {
    "cap2": "巴西矿区 · 现场逐批精选",
    "cap3": "首批近8吨白水晶 · 已发货直达中国",
    "cap4": "新品到货:紫水晶 · 红碧玉",
    "cap5": "东海仓库:曲阳水晶街赵庄村",
}
for name, txt in caps.items():
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(56)
    tw, th = text_w(d, txt, f)
    pad_x, pad_y = 50, 34
    bw, bh = tw + 2 * pad_x, th + 2 * pad_y + 14
    x0, y0 = (W - bw) / 2, 1560
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=22, fill=PURPLE_A)
    d.rectangle([x0 + bw / 2 - 40, y0 + 16, x0 + bw / 2 + 40, y0 + 20], fill=GOLD)
    d.text((x0 + pad_x, y0 + pad_y + 10), txt, font=f, fill=WHITE)
    img.save(f"assets/{name}.png")

# ---------- watermark logo ----------
logo = Image.open("media/aKAY nEW lOGO.png").convert("RGBA")
lw = 150
logo_s = logo.resize((lw, int(logo.height * lw / logo.width)))
alpha = logo_s.split()[3].point(lambda a: int(a * 0.9))
logo_s.putalpha(alpha)
wm = Image.new("RGBA", (W, H), (0, 0, 0, 0))
wm.paste(logo_s, (W - lw - 50, 60), logo_s)
wm.save("assets/watermark.png")

# ---------- CTA card ----------
img = Image.new("RGBA", (W, H), PURPLE + (255,))
d = ImageDraw.Draw(img)
# subtle vignette
vg = Image.new("L", (W, H), 0)
dv = ImageDraw.Draw(vg)
dv.ellipse([-300, -300, W + 300, H + 300], fill=40)
vg = vg.filter(ImageFilter.GaussianBlur(200))
img.paste(Image.new("RGBA", (W, H), (255, 255, 255, 255)), (0, 0), vg.point(lambda a: a // 6))
d = ImageDraw.Draw(img)

logo_big = logo.resize((220, int(logo.height * 220 / logo.width)))
img.paste(logo_big, ((W - 220) // 2, 130), logo_big)
y = 130 + logo_big.height + 40
y += center_text(d, y, "AKAY  IRELAND", font(44), GOLD) + 50
y += center_text(d, y, "扫码加微信", font(100), WHITE) + 40
y += center_text(d, y, "询价 · 看货 · 长期合作", font(52), (230, 220, 238)) + 70

# QR tiles
qr_daniel = Image.open("flier_imgs/main_p0_0_800x800.png").convert("RGB")
qr_anil_full = Image.open("media/qr code anil.jpeg").convert("RGB")
# crop anil QR (QR occupies center-left region of the screenshot)
wA, hA = qr_anil_full.size
qr_anil = qr_anil_full.crop((int(wA * 0.28), int(hA * 0.145), int(wA * 0.735), int(hA * 0.60)))

tile = 430
qr_sz = 370
gap = 60
x_start = (W - 2 * tile - gap) // 2
labels = ["仓库经理 Daniel", "Anil Khetan"]
for i, qr in enumerate([qr_daniel, qr_anil]):
    x = x_start + i * (tile + gap)
    d.rounded_rectangle([x, y, x + tile, y + tile], radius=28, fill=WHITE)
    q = qr.resize((qr_sz, qr_sz))
    img.paste(q, (x + (tile - qr_sz) // 2, y + (tile - qr_sz) // 2))
    f = font(42)
    twl, _ = text_w(d, labels[i], f)
    d.text((x + (tile - twl) / 2, y + tile + 24), labels[i], font=f, fill=WHITE)
y += tile + 110

y += center_text(d, y, "微信号:anilkhetan1", font(46), (230, 220, 238)) + 60
d.rectangle([W / 2 - 60, y, W / 2 + 60, y + 5], fill=GOLD)
y += 45
y += center_text(d, y, "仓库地址:曲阳水晶街赵庄村", font(48), WHITE) + 28
y += center_text(d, y, "规格齐全 · 现货供应 · 量大优惠", font(44), (230, 220, 238)) + 28
y += center_text(d, y, "www.akay.ie", font(40), GOLD)
img.convert("RGB").save("assets/cta.png")
print("assets done", os.listdir("assets"))
