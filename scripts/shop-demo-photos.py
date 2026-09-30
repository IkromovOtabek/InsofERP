"""E-commerce demo suratlari: har mahsulot uchun 800x600 PNG (uploads/shop/demo-<code>.png).
Haqiqiy surat yuklanguncha vitrina bo'sh ko'rinmasin. Ishlatish: python3 scripts/shop-demo-photos.py"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "uploads", "shop")
os.makedirs(OUT, exist_ok=True)
F = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FR = "/System/Library/Fonts/Supplemental/Arial.ttf"

# code, sarlavha, pastki yozuv, rang (yuqori, pastki), shakl
ITEMS = [
    ("M150", "M150", "Beton B12,5", ((120, 128, 140), (70, 76, 88)), "mixer"),
    ("M200", "M200", "Beton B15", ((245, 158, 11), (180, 83, 9)), "mixer"),
    ("M250", "M250", "Beton B20", ((234, 88, 12), (154, 52, 18)), "mixer"),
    ("M300", "M300", "Beton B22,5", ((29, 78, 216), (30, 58, 138)), "mixer"),
    ("M350", "M350", "Beton B25", ((15, 118, 110), (19, 78, 74)), "mixer"),
    ("M400", "M400", "Beton B30", ((109, 40, 217), (76, 29, 149)), "mixer"),
    ("USTUN", "Ustun", "2,5 m temir-beton", ((71, 85, 105), (30, 41, 59)), "pillar"),
    ("FBS24", "FBS", "24.4.6 poydevor bloki", ((100, 116, 139), (51, 65, 85)), "block"),
    ("085", "2PK", "Kovak plita", ((87, 83, 78), (41, 37, 36)), "slab"),
    ("BR100", "BR 100", "Bordyur 100.30.15", ((148, 163, 184), (71, 85, 105)), "curb"),
    ("TP8", "Plitka", "Trotuar 8 sm", ((202, 138, 4), (133, 77, 14)), "tiles"),
    ("KS10", "KS 10-9", "Quduq halqasi", ((13, 148, 136), (17, 94, 89)), "ring"),
    ("KB600", "Gazoblok", "600x300x200", ((226, 232, 240), (148, 163, 184)), "block"),
    ("SV6", "Svaya", "S 60.30", ((68, 64, 60), (28, 25, 23)), "pillar"),
    ("M100", "M100", "Beton B7,5", ((148, 163, 184), (100, 116, 139)), "mixer"),
    ("RM100", "Qorishma", "M100 terish/suvoq", ((161, 98, 7), (113, 63, 18)), "mixer"),
    ("PK60", "PK 60.12", "Kovak yopma plita", ((68, 64, 60), (41, 37, 36)), "slab"),
    ("2PB17", "2PB 17-2", "Peremichka", ((82, 82, 91), (39, 39, 42)), "curb"),
    ("1PP10", "1PP 10-1", "Quduq qopqog'i", ((8, 145, 178), (22, 78, 99)), "ring"),
    ("BR80", "BR 100.20.8", "Bog' bordyuri", ((101, 163, 13), (63, 98, 18)), "curb"),
    ("TP6", "Brusschatka", "6 sm", ((190, 18, 60), (136, 19, 55)), "tiles"),
    ("LT50", "Lotok", "Suv oqava 500x160", ((2, 132, 199), (7, 89, 133)), "curb"),
    ("FBS12", "FBS", "12.4.6 poydevor bloki", ((71, 85, 105), (30, 41, 59)), "block"),
    ("BB390", "Beton blok", "390x190x188 kovak", ((113, 113, 122), (63, 63, 70)), "block"),
    ("KZ390", "Keramzitoblok", "390x190x188", ((194, 65, 12), (124, 45, 18)), "block"),
]

def grad(w, h, a, b):
    im = Image.new("RGB", (w, h), a)
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3)))
    return im

def shape(d, kind, cx, cy):
    c = (255, 255, 255, 60)
    if kind == "mixer":  # mikser barabani + kabina
        d.rounded_rectangle([cx - 230, cy - 20, cx + 150, cy + 60], 14, fill=c)
        d.ellipse([cx - 210, cy - 150, cx + 90, cy + 20], fill=c)
        d.rounded_rectangle([cx + 160, cy - 80, cx + 250, cy + 60], 12, fill=c)
        for x in (cx - 170, cx - 60, cx + 200):
            d.ellipse([x - 32, cy + 40, x + 32, cy + 104], fill=(255, 255, 255, 90))
    elif kind == "pillar":
        for i in range(4):
            d.rectangle([cx - 250 + i * 130, cy - 150, cx - 190 + i * 130, cy + 110], fill=c)
    elif kind == "block":
        for r in range(3):
            for i in range(3 - (r % 2)):
                x = cx - 240 + i * 170 + (r % 2) * 85
                d.rectangle([x, cy + 40 - r * 75, x + 160, cy + 105 - r * 75], fill=c)
    elif kind == "slab":
        for r in range(3):
            y = cy - 110 + r * 70
            d.rectangle([cx - 260, y, cx + 260, y + 55], fill=c)
            for i in range(6):
                d.ellipse([cx - 230 + i * 85, y + 12, cx - 200 + i * 85, y + 42], fill=(0, 0, 0, 50))
    elif kind == "curb":
        for r in range(3):
            d.polygon([(cx - 260, cy + 90 - r * 80), (cx + 260, cy + 90 - r * 80), (cx + 260, cy + 30 - r * 80), (cx - 200, cy + 30 - r * 80)], fill=c)
    elif kind == "tiles":
        for r in range(4):
            for i in range(6):
                x, y = cx - 270 + i * 90 + (r % 2) * 45, cy - 140 + r * 65
                d.rounded_rectangle([x, y, x + 80, y + 55], 6, fill=c)
    elif kind == "ring":
        for i in range(3):
            d.ellipse([cx - 200 + i * 20, cy - 150 + i * 70, cx + 200 - i * 20, cy - 40 + i * 70], outline=(255, 255, 255, 110), width=26)

for code, title, sub, (a, b), kind in ITEMS:
    W, H = 800, 600
    im = grad(W, H, a, b).convert("RGBA")
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shape(ImageDraw.Draw(ov), kind, W // 2, 230)
    im = Image.alpha_composite(im, ov)
    d = ImageDraw.Draw(im)
    dark = sum(a) > 600  # och fon (gazoblok) — to'q yozuv
    ink = (30, 41, 59) if dark else (255, 255, 255)
    d.text((48, 410), title, font=ImageFont.truetype(F, 84), fill=ink)
    d.text((52, 510), sub, font=ImageFont.truetype(FR, 36), fill=ink)
    d.text((W - 190, 40), "INSOF JBI", font=ImageFont.truetype(F, 28), fill=ink)
    im.convert("RGB").save(os.path.join(OUT, f"demo-{code}.png"), optimize=True)
print(f"{len(ITEMS)} ta surat: {os.path.abspath(OUT)}")

# ── Reklama (ADS) bannerlari — 1200x675 (16:9), ERP uploads/shop/demo-banner-*.png ──
def banner(path, top, bottom, kicker, title, sub, kind, cta):
    W, H = 1200, 675
    im = grad(W, H, top, bottom).convert("RGBA")
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shape(ImageDraw.Draw(ov), kind, 860, 300)
    im = Image.alpha_composite(im, ov)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([60, 60, 60 + d.textlength(kicker, font=ImageFont.truetype(F, 30)) + 40, 116], 28, fill=(255, 255, 255, 235))
    d.text((80, 70), kicker, font=ImageFont.truetype(F, 30), fill=bottom)
    y = 160
    for line in title.split("\n"):
        d.text((60, y), line, font=ImageFont.truetype(F, 76), fill=(255, 255, 255)); y += 88
    d.text((62, y + 14), sub, font=ImageFont.truetype(FR, 36), fill=(255, 255, 255))
    d.rounded_rectangle([60, 560, 60 + d.textlength(cta, font=ImageFont.truetype(F, 32)) + 64, 624], 32, fill=(255, 255, 255))
    d.text((92, 574), cta, font=ImageFont.truetype(F, 32), fill=bottom)
    im.convert("RGB").save(path, optimize=True)

BANNERS = [
    ("demo-banner-m200.png", (245, 158, 11), (180, 83, 9), "CHEGIRMA −4%", "M200 beton\n530 000 so'm", "Shu oy oxirigacha, 2 m³ dan", "mixer", "Buyurtma berish"),
    ("demo-banner-gazoblok.png", (15, 118, 110), (19, 78, 74), "YANGI MAHSULOT", "Gazoblok D500", "Issiq va yengil devor — 16 000 so'm/dona", "block", "Batafsil"),
    ("demo-banner-yetkazish.png", (29, 78, 216), (30, 58, 138), "BEPUL YETKAZISH", "10 m³ dan ortiq\nbuyurtmaga", "Toshkent shahri bo'ylab, 15 km gacha", "mixer", "Katalog"),
]
for f, a, b, k, t, s, kind, cta in BANNERS:
    banner(os.path.join(OUT, f), a, b, k, t, s, kind, cta)

# ── "Nega Insof JBI" slaydlari — ilovaga qo'shiladi (InsofECO/apps/mobile/assets/shop/) ──
APP = os.path.expanduser("~/Desktop/InsofECO/apps/mobile/assets/shop")
os.makedirs(APP, exist_ok=True)
REASONS = [
    ("why-kafolat.png", (22, 101, 52), (20, 83, 45), "NEGA INSOF JBI", "Zavod kafolati", "Har partiya laboratoriyada sinovdan\no'tadi — sertifikat bilan", "ring", "Sifat pasporti"),
    ("why-yetkazish.png", (29, 78, 216), (30, 58, 138), "NEGA INSOF JBI", "O'z transportimiz", "Mikser va nasos — obyektga\nkelishilgan vaqtda", "mixer", "GPS kuzatuv"),
    ("why-narx.png", (234, 88, 12), (154, 52, 18), "NEGA INSOF JBI", "Zavod narxi", "Vositachisiz — to'g'ridan-to'g'ri\nishlab chiqaruvchidan", "block", "Ulgurji chegirma"),
]
def reason(path, top, bottom, kicker, title, sub, kind, cta):
    W, H = 1200, 675
    im = grad(W, H, top, bottom).convert("RGBA")
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shape(ImageDraw.Draw(ov), kind, 870, 300)
    im = Image.alpha_composite(im, ov)
    d = ImageDraw.Draw(im)
    d.text((60, 70), kicker, font=ImageFont.truetype(F, 30), fill=(255, 255, 255, 200))
    d.text((60, 150), title, font=ImageFont.truetype(F, 84), fill=(255, 255, 255))
    y = 270
    for line in sub.split("\n"):
        d.text((62, y), line, font=ImageFont.truetype(FR, 40), fill=(255, 255, 255)); y += 52
    d.rounded_rectangle([60, 560, 60 + d.textlength(cta, font=ImageFont.truetype(F, 32)) + 64, 624], 32, outline=(255, 255, 255), width=3)
    d.text((92, 574), cta, font=ImageFont.truetype(F, 32), fill=(255, 255, 255))
    im.convert("RGB").save(path, optimize=True)
for f, a, b, k, t, s, kind, cta in REASONS:
    reason(os.path.join(APP, f), a, b, k, t, s, kind, cta)
print(f"{len(BANNERS)} banner, {len(REASONS)} 'Nega biz' slaydi")
