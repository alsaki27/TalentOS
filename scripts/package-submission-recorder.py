"""Build a deterministic extension ZIP containing only the six runtime files."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

root = Path(__file__).resolve().parents[1]
destination = root / "public/downloads/talentos-submission-recorder.zip"
destination.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
    for name in ["manifest.json", "background.js", "content.js", "popup.html", "popup.js", "popup.css"]:
        info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (root / "extensions/submission-recorder" / name).read_bytes())
print(destination)
