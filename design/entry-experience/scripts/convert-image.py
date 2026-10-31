from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / "assets" / "entry-scene.png"
target = root / "assets" / "entry-scene.webp"
with Image.open(source) as image:
    image.save(target, "WEBP", quality=90, method=6)
print(f"{target.name}: {target.stat().st_size} bytes")
