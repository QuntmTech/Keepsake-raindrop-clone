from pathlib import Path

path = Path(__file__).with_name('apply-quickbar-dock-release.py')
text = path.read_text()
old = '''quickbar = replace_once(
    quickbar,
    "  applyAll();",
    "  renderActions();\\n  applyAll();",
    "initial render actions",
)'''
new = '''quickbar = replace_once(
    quickbar,
    "  };\\n\\n  applyAll();\\n\\n  const onResize = () => {",
    "  };\\n\\n  renderActions();\\n  applyAll();\\n\\n  const onResize = () => {",
    "initial render actions",
)'''
if text.count(old) != 1:
    raise RuntimeError(f'Expected one generator block, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
