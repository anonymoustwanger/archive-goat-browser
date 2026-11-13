#!/usr/bin/env python3
"""Adds Goat to an ungoogled-chromium-windows checkout before it builds.

Usage: python hook.py <ungoogled-chromium-windows dir>

- Goat's source patches go at the end of the patch series.
- build.py runs brand.py right after the source is patched (first stage only).
Safe to run more than once.
"""

import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
UCW = Path(sys.argv[1]).resolve()

# Patches
dest = UCW / 'patches' / 'goat'
dest.mkdir(parents=True, exist_ok=True)
series_path = UCW / 'patches' / 'series'
series = series_path.read_text(encoding='utf-8').splitlines()
for patch in sorted((HERE / 'patches').glob('*.patch')):
    shutil.copyfile(patch, dest / patch.name)
    entry = f'goat/{patch.name}'
    if entry not in series:
        series.append(entry)
series_path.write_text('\n'.join(series) + '\n', encoding='utf-8')

# Branding step
build_py = UCW / 'build.py'
text = build_py.read_text(encoding='utf-8')
anchor = """        domain_substitution.apply_substitution(
            _ROOT_DIR / 'ungoogled-chromium' / 'domain_regex.list',
            domain_substitution_list,
            source_tree,
            None
        )
"""
step = f"""
        # Goat Browser: names, strings and icons
        subprocess.run([sys.executable, {str(HERE / 'brand.py')!r}, str(source_tree)], check=True)
"""
if 'Goat Browser: names' not in text:
    if anchor not in text:
        sys.exit('hook.py: build.py changed; cannot find the domain substitution step')
    text = text.replace(anchor, anchor + step)
    build_py.write_text(text, encoding='utf-8')
print('hook.py: Goat added to', UCW)
