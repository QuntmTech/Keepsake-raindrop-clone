from pathlib import Path

path = Path('scripts/apply-8121-startup-polish.py')
source = path.read_text()
helper_anchor = '''def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one {label}, found {count}")
    file.write_text(source.replace(old, new, 1))
'''
helper_replacement = helper_anchor + '''

def replace_first(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    source = file.read_text()
    if old not in source:
        raise RuntimeError(f"{path}: missing {label}")
    file.write_text(source.replace(old, new, 1))
'''
if source.count(helper_anchor) != 1:
    raise RuntimeError('Could not find generator helper')
source = source.replace(helper_anchor, helper_replacement, 1)

for label in ('deferred install maintenance', 'deferred startup maintenance'):
    marker = f'''    "{label}",\n)'''
    end = source.find(marker)
    if end < 0:
        raise RuntimeError(f'Missing {label} call')
    start = source.rfind('replace_once(', 0, end)
    if start < 0:
        raise RuntimeError(f'Missing start for {label}')
    source = source[:start] + 'replace_first(' + source[start + len('replace_once('):]

path.write_text(source)
Path(__file__).unlink(missing_ok=True)
