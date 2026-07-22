from pathlib import Path
import re

path = Path(__file__).resolve().parents[1] / 'lib/quickbar.ts'
text = path.read_text()
marker = '  let existing: Bookmark | null = null;'
if text.count(marker) != 1:
    raise RuntimeError(f'expected one Quick Bar bookmark-state marker, found {text.count(marker)}')
prefix, suffix = text.split(marker, 1)
suffix = re.sub(r'\bexisting\b', 'existingBookmark', suffix)
path.write_text(prefix + '  let existingBookmark: Bookmark | null = null;' + suffix)
print('Renamed Quick Bar bookmark state without touching the DOM host variable.')
