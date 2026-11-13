#!/usr/bin/env python3
"""Adds Goat to an ungoogled-chromium-portablelinux checkout before it builds.

Usage: python3 hook_linux.py <portablelinux dir>   (Goat must be in <dir>/goat-src)

- Goat's source patches go at the end of the patch series.
- The source is branded right after patching (brand.py runs inside the build container).
- The build container gets Pillow for the icons.
Safe to run more than once.
"""

import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
UCL = Path(sys.argv[1]).resolve()


def replace_once(path, anchor, addition, marker):
    text = path.read_text(encoding='utf-8')
    if marker in text:
        return
    if anchor not in text:
        sys.exit(f'hook_linux.py: {path.name} changed; cannot find: {anchor.strip()}')
    path.write_text(text.replace(anchor, addition, 1), encoding='utf-8')


# Patches
dest = UCL / 'patches' / 'goat'
dest.mkdir(parents=True, exist_ok=True)
series_path = UCL / 'patches' / 'series'
series = series_path.read_text(encoding='utf-8').splitlines()
for patch in sorted((HERE / 'patches').glob('*.patch')):
    shutil.copyfile(patch, dest / patch.name)
    entry = f'goat/{patch.name}'
    if entry not in series:
        series.append(entry)
series_path.write_text('\n'.join(series) + '\n', encoding='utf-8')

# Branding right after the patches (paths are inside the container: /repo = checkout)
anchor = '''        "${_main_repo}/utils/patches.py" apply "${_src_dir}" "${_main_repo}/patches" "${_root}/patches"
'''
replace_once(UCL / 'scripts' / 'shared.sh', anchor,
             anchor + '''        python3 "${_root}/goat-src/chromium/brand.py" "${_src_dir}"  # Goat Browser branding
''', 'Goat Browser branding')

# Pillow in the build image
docker = UCL / 'docker' / 'build.Dockerfile'
replace_once(docker, 'RUN apt-get -y install bison ', 'RUN apt-get -y install python3-pil bison ', 'python3-pil')

print('hook_linux.py: Goat added to', UCL)
