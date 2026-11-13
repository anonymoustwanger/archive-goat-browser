#!/usr/bin/env python3
"""Turns a patched ungoogled-chromium source tree into Goat Browser.

Usage: python brand.py <chromium src dir>

Changes only names, strings and icons (no code). Every edit checks that it
matched, so a Chromium update that moves things fails here in minutes instead
of producing a half-branded browser hours later.
"""

import re
import sys
from pathlib import Path

NAME = 'Goat Browser'
HERE = Path(__file__).resolve().parent
SRC = Path(sys.argv[1]).resolve()


def edit(rel, pairs):
    path = SRC / rel
    text = path.read_text(encoding='utf-8')
    for old, new in pairs:
        if old not in text:
            if new in text:
                continue  # already applied
            sys.exit(f'brand.py: "{old}" not found in {rel}')
        text = text.replace(old, new)
    path.write_text(text, encoding='utf-8', newline='')


# --------------------------------------------------------------- names
def branding_file():
    path = SRC / 'chrome/app/theme/chromium/BRANDING'
    values = {
        'COMPANY_FULLNAME': NAME,
        'COMPANY_SHORTNAME': NAME,
        'PRODUCT_FULLNAME': NAME,
        'PRODUCT_SHORTNAME': NAME,
        'PRODUCT_INSTALLER_FULLNAME': f'{NAME} Installer',
        'PRODUCT_INSTALLER_SHORTNAME': f'{NAME} Installer',
        'COPYRIGHT': f'Copyright @LASTCHANGE_YEAR@ {NAME} and The Chromium Authors. All rights reserved.',
        'MAC_BUNDLE_ID': 'org.goatbrowser.GoatBrowser',
    }
    lines = []
    seen = set()
    for line in path.read_text(encoding='utf-8').splitlines():
        key = line.split('=', 1)[0]
        if key in values:
            line = f'{key}={values[key]}'
            seen.add(key)
        lines.append(line)
    missing = set(values) - seen
    if missing:
        sys.exit(f'brand.py: BRANDING has no {sorted(missing)}')
    path.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def install_modes():
    # Install folder %LOCALAPPDATA%\Goat Browser\Application, user data in
    # %LOCALAPPDATA%\Goat Browser\User Data, own taskbar identity and file
    # associations. GUIDs stay as they are (they must match compiled IDL).
    edit('chrome/install_static/chromium_install_modes.h', [
        ('kProductPathName[] = L"Chromium";', f'kProductPathName[] = L"{NAME}";'),
        ('.base_app_name = L"Chromium",', f'.base_app_name = L"{NAME}",'),
        ('.base_app_id = L"Chromium",', '.base_app_id = L"GoatBrowser",'),
        ('.browser_prog_id_prefix = L"ChromiumHTM",', '.browser_prog_id_prefix = L"GoatHTM",'),
        ('L"Chromium HTML Document",', f'L"{NAME} HTML Document",'),
        ('.pdf_prog_id_prefix = L"ChromiumPDF",', '.pdf_prog_id_prefix = L"GoatPDF",'),
        ('L"Chromium PDF Document",', f'L"{NAME} PDF Document",'),
    ])


# -------------------------------------------------------------- strings
# "Chromium" in user-visible text becomes "Goat Browser". Names of other
# projects ("Chromium OS", "The Chromium Authors") stay.
WORD = re.compile(r'\bChromium\b(?!\s*(?:OS|Authors|Projects?|project|Flex|Enterprise)\b)')
MESSAGE = re.compile(r'(<message\b[^>]*>)(.*?)(</message>)', re.S)
TRANSLATION = re.compile(r'<translation id="(\d+)"([^>]*)>(.*?)</translation>', re.S)


def grit_ids(grd):
    """Message fingerprints (the ids .xtb translations are keyed by)."""
    sys.path.insert(0, str(SRC / 'tools/grit'))
    try:
        from grit import grd_reader  # pylint: disable=import-outside-toplevel
    finally:
        sys.path.pop(0)
    defs = {}
    for _ in range(100):
        try:
            root = grd_reader.Parse(str(grd), defines=defs, target_platform='win32')
            break
        except AssertionError as exc:
            m = re.search(r'variable found: (\w+)', str(exc))
            if not m:
                raise
            defs[m.group(1)] = False
    else:
        sys.exit(f'brand.py: could not parse {grd}')
    out = []
    for node in root.Preorder():
        if node.name == 'message':
            out.append(node.GetCliques()[0].GetMessage().GetId())
    return out


def rebrand_text(text):
    return MESSAGE.sub(lambda m: m.group(1) + WORD.sub(NAME, m.group(2)) + m.group(3), text)


def strings(grd_rel):
    grd = SRC / grd_rel
    files = [grd] + [grd.parent / p for p in re.findall(r'<part file="([^"]+)"', grd.read_text(encoding='utf-8'))]
    before = grit_ids(grd)
    changed = 0
    for f in files:
        old = f.read_text(encoding='utf-8')
        new = rebrand_text(old)
        if new != old:
            changed += 1
            f.write_text(new, encoding='utf-8', newline='')
    if not changed:
        if NAME in grd.read_text(encoding='utf-8'):
            print(f'brand.py: {grd_rel} already branded')
            return
        sys.exit(f'brand.py: no "Chromium" strings found in {grd_rel}')
    after = grit_ids(grd)
    if len(before) != len(after):
        sys.exit(f'brand.py: message count changed in {grd_rel}')
    remap = {b: a for b, a in zip(before, after) if b != a}

    # Keep translations: move each changed message's translation to its new id.
    xtbs = re.findall(r'<file path="([^"]+\.xtb)"', grd.read_text(encoding='utf-8'))
    moved = 0
    for rel in xtbs:
        xtb = grd.parent / rel
        if not xtb.exists():
            continue
        text = xtb.read_text(encoding='utf-8')
        present = set(re.findall(r'<translation id="(\d+)"', text))

        def fix(m):
            nonlocal moved
            tid, attrs, body = m.groups()
            if tid not in remap:
                return m.group(0)
            new_id = remap[tid]
            moved += 1
            if new_id in present:  # an identical message already has this translation
                return m.group(0)
            return f'<translation id="{new_id}"{attrs}>{WORD.sub(NAME, body)}</translation>'

        xtb.write_text(TRANSLATION.sub(fix, text), encoding='utf-8', newline='')
    print(f'brand.py: {grd_rel}: {len(remap)} messages renamed, {moved} translations moved')


# ---------------------------------------------------------------- icons
def icons():
    from PIL import Image  # pylint: disable=import-outside-toplevel
    logo = Image.open(HERE / 'branding/icon.png').convert('RGBA')

    def fit(w, h):
        side = min(w, h)
        img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        img.alpha_composite(logo.resize((side, side), Image.LANCZOS), ((w - side) // 2 if w == h else 0, (h - side) // 2))
        return img

    count = 0
    dirs = [SRC / 'chrome/app/theme/chromium'] + [SRC / f'chrome/app/theme/default_{p}_percent/chromium' for p in (100, 200)]
    for d in dirs:
        for png in d.rglob('*.png'):
            n = png.name
            if not (n.startswith('product_logo') or n.startswith('appicon_') or n.startswith('chrome_app_icon')
                    or png.parent.name == 'tiles'):
                continue
            w, h = Image.open(png).size
            fit(w, h).save(png)
            count += 1
    ico_sizes = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)]
    for name in ('chromium.ico', 'app_list.ico'):
        ico = SRC / 'chrome/app/theme/chromium/win' / name
        if not ico.exists():
            sys.exit(f'brand.py: {ico} missing')
        logo.resize((256, 256), Image.LANCZOS).save(ico, sizes=ico_sizes)
        count += 1
    if count < 10:
        sys.exit(f'brand.py: only {count} icons found; the theme folders moved')
    print(f'brand.py: {count} icons replaced')


def linux_paths():
    # Linux: profile in ~/.config/goat-browser instead of ~/.config/chromium.
    rel = 'chrome/common/chrome_paths_linux.cc'
    if (SRC / rel).exists():
        edit(rel, [('std::string data_dir_basename = "chromium";', 'std::string data_dir_basename = "goat-browser";')])


def main():
    if not (SRC / 'BUILD.gn').exists():
        sys.exit(f'brand.py: {SRC} is not a Chromium source tree')
    branding_file()
    install_modes()
    linux_paths()
    strings('chrome/app/chromium_strings.grd')
    strings('components/components_chromium_strings.grd')
    icons()
    print('brand.py: done')


if __name__ == '__main__':
    main()
