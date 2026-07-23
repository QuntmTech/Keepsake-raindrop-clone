from pathlib import Path

PATH = Path('entrypoints/studio/ImageEditor.tsx')
source = PATH.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'Expected exactly one {label}, found {count}')
    source = source.replace(old, new, 1)

replace_once(
    "    const [sizeKey, setSizeKey] = useState('m');\n    const [loaded, setLoaded] = useState(false);",
    "    const [sizeKey, setSizeKey] = useState('m');\n    const [zoom, setZoom] = useState<'fit' | 25 | 50 | 100 | 200>('fit');\n    const [loaded, setLoaded] = useState(false);",
    'zoom state',
)

sizes_block = '''          <div className="flex rounded-lg border border-line p-0.5">
            {SIZES.map((s) => (
              <button
                key={s.key}
                className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                  sizeKey === s.key ? 'bg-brand text-white' : 'text-ink-faint hover:text-ink'
                }`}
                onClick={() => setSizeKey(s.key)}
                title={`${s.label} stroke`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span className="h-6 w-px bg-line" />'''
zoom_block = '''          <div className="flex rounded-lg border border-line p-0.5">
            {SIZES.map((s) => (
              <button
                key={s.key}
                className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                  sizeKey === s.key ? 'bg-brand text-white' : 'text-ink-faint hover:text-ink'
                }`}
                onClick={() => setSizeKey(s.key)}
                title={`${s.label} stroke`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span className="h-6 w-px bg-line" />
          <label className="flex items-center gap-1.5 text-xs text-ink-faint" title="Preview zoom — exports always remain full resolution">
            Zoom
            <select
              className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
              value={String(zoom)}
              onChange={(event) => {
                const value = event.target.value;
                setZoom(value === 'fit' ? 'fit' : (Number(value) as 25 | 50 | 100 | 200));
              }}
            >
              <option value="fit">Fit</option>
              <option value="25">25%</option>
              <option value="50">50%</option>
              <option value="100">100%</option>
              <option value="200">200%</option>
            </select>
          </label>
          <span className="h-6 w-px bg-line" />'''
replace_once(sizes_block, zoom_block, 'size and zoom toolbar')

replace_once(
    '''              className={`block max-w-full rounded-lg border border-line bg-white shadow-card ${
                tool === 'text' ? 'cursor-text' : 'cursor-crosshair'
              }`}
              onPointerDown={onDown}''',
    '''              className={`block rounded-lg border border-line bg-white shadow-card ${
                zoom === 'fit' ? 'max-w-full' : 'max-w-none'
              } ${tool === 'text' ? 'cursor-text' : 'cursor-crosshair'}`}
              style={zoom === 'fit' ? undefined : { width: `${(baseRef.current?.width ?? 1) * (zoom / 100)}px` }}
              onPointerDown={onDown}''',
    'zoomed canvas',
)

PATH.write_text(source)
Path(__file__).unlink(missing_ok=True)
