#!/usr/bin/env python3
"""Stage a local extension and open the default Linux browser's management UI."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('install', 'uninstall'))
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    desktop = subprocess.check_output(
        ['xdg-settings', 'get', 'default-web-browser'], text=True).strip()
    if not desktop or Path(desktop).name != desktop:
        sys.exit('Could not determine the default browser desktop entry.')
    browser = desktop.lower()
    if 'brave' in browser:
        page, target = 'brave://extensions/', 'chrome'
    elif any(name in browser for name in ('chrome', 'chromium', 'edge', 'vivaldi')):
        page, target = 'chrome://extensions/', 'chrome'
    elif any(name in browser for name in ('firefox', 'waterfox', 'librewolf')):
        page, target = 'about:debugging#/runtime/this-firefox', 'firefox'
    else:
        sys.exit(f'Unsupported default browser: {desktop}')
    data_home = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
    data_dirs = [data_home, *map(Path, os.environ.get('XDG_DATA_DIRS', '/usr/local/share:/usr/share').split(':'))]
    entry = next((base / 'applications' / desktop for base in data_dirs
                  if (base / 'applications' / desktop).is_file()), None)
    if entry is None:
        sys.exit(f'Cannot find desktop entry: {desktop}')
    root = Path(__file__).resolve().parents[1]
    destination = data_home / 'blockwork-browser' / target
    print(f'Default browser: {desktop}')
    print(f'Extension directory: {destination}')
    if args.action == 'install':
        if not args.dry_run:
            subprocess.run(['node', 'build.mjs'], cwd=root, check=True)
            # Keep the installed path independent of subsequent builds in dist/.
            shutil.copytree(root / 'dist' / target, destination, dirs_exist_ok=True)
        if target == 'chrome':
            print('Enable Developer mode, choose Load unpacked, and select the directory above.')
            print('If already loaded, click Reload on the Blockwork extension.')
        else:
            print(f'Choose Load Temporary Add-on and select {destination / "manifest.json"}.')
            print('Firefox temporary installations last until the browser exits.')
    else:
        print('Find Blockwork and click Remove in the browser to finish uninstalling.')
        print('Staged files are retained so an active extension is not broken before removal.')
    print(f'Opening {page}', flush=True)
    if not args.dry_run:
        subprocess.run(['gio', 'launch', str(entry), page], check=True)


if __name__ == '__main__':
    main()
