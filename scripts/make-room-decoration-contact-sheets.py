from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json

root = Path(__file__).resolve().parent.parent
source = root / "docs/kimi/verification/room-decorations"
files = sorted(source.glob("room-*.png"))
if len(files) != 50:
    raise RuntimeError(f"Expected 50 source captures, found {len(files)}")
font_candidates = [
    Path("/System/Library/Fonts/PingFang.ttc"),
    Path("/System/Library/Fonts/STHeiti Light.ttc"),
    Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
]
font_path = next((path for path in font_candidates if path.exists()), None)
font = ImageFont.truetype(str(font_path), 22) if font_path else ImageFont.load_default()
title_font = ImageFont.truetype(str(font_path), 25) if font_path else ImageFont.load_default()
manifest = []
for file in files:
    with Image.open(file) as image:
        manifest.append({"file": file.name, "bytes": file.stat().st_size, "width": image.width, "height": image.height})
(source / "image-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
room_names = {}
for report_name in ["runtime-captures-a.json", "runtime-captures-b.json"]:
    report = json.loads((source / report_name).read_text(encoding="utf-8"))
    for capture in report["captures"]:
        room_names[capture["roomId"]] = capture["room"]
views = ["game", "sign", "material-solid", "material-surface", "overview"]
for room_id in range(10):
    sheet = Image.new("RGB", (1440, 1590), "#1d2a24")
    draw = ImageDraw.Draw(sheet)
    for index, view in enumerate(views):
        file = source / f"room-{room_id:02d}-{view}.png"
        with Image.open(file) as image:
            image = image.convert("RGB")
            image.thumbnail((704, 469), Image.Resampling.LANCZOS)
            x = (index % 2) * 720 + 8
            y = (index // 2) * 530 + 42
            sheet.paste(image, (x, y))
            draw.text((x, 10 + (index // 2) * 530), f"{room_id:02d} {room_names[room_id]} · {view}", fill="#e5d6ae", font=font)
    output = source / f"contact-room-{room_id:02d}.jpg"
    sheet.save(output, quality=90, optimize=True)
# Full-resolution review copies keep the originals untouched and stay below the media-read limit.
for file in files:
    if file.stat().st_size > 3 * 1024 * 1024:
        with Image.open(file) as image:
            image = image.convert("RGB")
            image.thumbnail((1440, 960), Image.Resampling.LANCZOS)
            image.save(source / f"review-{file.stem}.jpg", quality=91, optimize=True)
print(json.dumps({"captures": len(files), "contactSheets": 10, "largestBytes": max(item["bytes"] for item in manifest), "oversizedOriginals": [item["file"] for item in manifest if item["bytes"] > 3 * 1024 * 1024]}, ensure_ascii=False))
