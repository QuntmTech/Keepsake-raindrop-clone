from pathlib import Path

path = Path('scripts/apply-8121-performance.py')
source = path.read_text()
old = '''replace_once(
    "lib/quickbar.ts",
    "  host.style.setProperty('--ks-accent', accent);",
    "  host.style.setProperty('--ks-accent', accent);\\n  host.style.setProperty('--ks-rail-width', `${railWidth}px`);\\n  host.style.setProperty('--ks-icon-size', `${actionIconSize}px`);",
    "initial sizing variables",
)'''
new = '''replace_once(
    "lib/quickbar.ts",
    "  host.style.setProperty('--ks-accent', accent);\\n  const shadow = host.attachShadow({ mode: 'open' });",
    "  host.style.setProperty('--ks-accent', accent);\\n  host.style.setProperty('--ks-rail-width', `${railWidth}px`);\\n  host.style.setProperty('--ks-icon-size', `${actionIconSize}px`);\\n  const shadow = host.attachShadow({ mode: 'open' });",
    "initial sizing variables",
)'''
if source.count(old) != 1:
    raise RuntimeError(f'Expected one generator anchor, found {source.count(old)}')
path.write_text(source.replace(old, new, 1))
Path(__file__).unlink(missing_ok=True)
