from pathlib import Path
import runpy

root = Path(__file__).resolve().parents[1]
generator = root / 'scripts' / 'apply-quickbar-dock-release.py'
source = generator.read_text()

old = '''quickbar = replace_once(
    quickbar,
    "  applyAll();",
    "  renderActions();\\n  applyAll();",
    "initial render actions",
)'''
new = '''initial_render_marker = "  applyAll();"
initial_render_index = quickbar.rfind(initial_render_marker)
if initial_render_index < 0:
    raise RuntimeError("initial render actions: marker not found")
quickbar = (
    quickbar[:initial_render_index]
    + "  renderActions();\\n  applyAll();"
    + quickbar[initial_render_index + len(initial_render_marker):]
)'''

if old not in source:
    raise RuntimeError('Could not patch the Quick Bar generator deterministically')

generator.write_text(source.replace(old, new, 1))
runpy.run_path(str(generator), run_name='__main__')
