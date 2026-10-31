from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/kimi/verification/motion"
GROUPS = {
    "contact-sheet-employees.jpg": [
        "seated-low-side.png",
        "chair-mount-side.png",
        "chair-work-front.png",
        "chair-work-side.png",
        "chair-work-back.png",
        "chair-work-perspective.png",
        "chair-pot-side.png",
        "chair-pot-perspective.png",
        "chair-dismount-side.png",
        "chair-recover-side.png",
        "chair-recover-perspective.png",
    ],
    "contact-sheet-leader.jpg": [
        "leader-patrol-perspective.png",
        "leader-inspect-side.png",
        "leader-inspect-perspective.png",
        "leader-search-left-front.png",
        "leader-search-left-perspective.png",
        "leader-search-right-front.png",
        "leader-search-right-perspective.png",
    ],
}

font = ImageFont.load_default(size=16)
for output, names in GROUPS.items():
    columns = 3
    tile_width, image_height, label_height = 480, 300, 28
    rows = (len(names) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * tile_width, rows * (image_height + label_height)), "#202720")
    draw = ImageDraw.Draw(sheet)
    for index, name in enumerate(names):
        x = (index % columns) * tile_width
        y = (index // columns) * (image_height + label_height)
        with Image.open(SOURCE / name) as source:
            tile = ImageOps.contain(source.convert("RGB"), (tile_width, image_height), Image.Resampling.LANCZOS)
        sheet.paste(tile, (x + (tile_width - tile.width) // 2, y + (image_height - tile.height) // 2))
        draw.text((x + 10, y + image_height + 5), name.removesuffix(".png"), fill="#e2dec9", font=font)
    sheet.save(SOURCE / output, quality=90, optimize=True)
    print(f"{output}: {len(names)} captures, {sheet.width}x{sheet.height}")
