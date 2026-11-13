#!/usr/bin/env python3
"""goat-host for Linux: same job and messages as GoatHost.cs on Windows.

  goat-host.py chrome-extension://...   native messaging host for the Goat extension
  goat-host.py --tor-daemon             runs Tor while Goat is open
  goat-host.py --tor-window             opens a Tor window (separate instance, throwaway profile)

Lives in <AppImage>/opt/goat-browser/goat/. Settings it writes go to
~/.config/goat-browser/settings.switches (the AppImage itself is read-only).
"""

import json
import os
import re
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import uuid

VERSION = '5.0.0'
SOCKS_PORT = 9250
CONTROL_PORT = 9251
EXTENSION_ID = 'hpgdgeidplcdilgooojfjcglokfpdmof'

GOAT_DIR = os.path.dirname(os.path.realpath(__file__))
APP_DIR = os.path.dirname(GOAT_DIR)  # opt/goat-browser (chrome lives here)
TOR_DIR = os.path.join(GOAT_DIR, 'tor')
TOR_EXE = os.path.join(TOR_DIR, 'tor', 'tor')
CONFIG = os.path.join(os.environ.get('XDG_CONFIG_HOME') or os.path.expanduser('~/.config'), 'goat-browser')
DATA_ROOT = os.path.join(os.environ.get('XDG_STATE_HOME') or os.path.expanduser('~/.local/state'), 'goat-browser', 'tor')
ERROR_FILE = os.path.join(DATA_ROOT, 'error.txt')
PID_FILE = os.path.join(DATA_ROOT, 'daemon.pid')

write_lock = threading.Lock()


def log(line):
    try:
        os.makedirs(DATA_ROOT, exist_ok=True)
        with open(os.path.join(DATA_ROOT, 'helper.log'), 'a', encoding='utf-8') as f:
            f.write(time.strftime('%Y-%m-%dT%H:%M:%S ') + line + '\n')
    except OSError:
        pass


# ---------------------------------------------------------------- messaging
def send(obj):
    body = json.dumps(obj).encode('utf-8')
    with write_lock:
        sys.stdout.buffer.write(struct.pack('<I', len(body)) + body)
        sys.stdout.buffer.flush()


def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    n = struct.unpack('<I', raw)[0]
    if n <= 0 or n > 1024 * 1024:
        return None
    body = sys.stdin.buffer.read(n)
    return json.loads(body.decode('utf-8')) if len(body) == n else None


def tor_status(state, progress=0, error=''):
    return {'type': 'tor', 'state': state, 'progress': progress, 'error': error or ''}


def handle(msg):
    cmd = msg.get('cmd', '')
    if cmd == 'status':
        vf = os.path.join(TOR_DIR, 'VERSION')
        return {'ok': True, 'version': VERSION, 'torInstalled': os.path.exists(TOR_EXE),
                'torVersion': open(vf).read().strip() if os.path.exists(vf) else ''}
    if cmd == 'tor-watch':
        why = ensure_daemon()
        if why:
            send(tor_status('error', 0, why))
            return None
        threading.Thread(target=watch_loop, daemon=True).start()
        return None
    if cmd == 'newnym':
        r = control('SIGNAL NEWNYM')
        return {'ok': True} if r and r.startswith('250') else {'error': "Tor isn't running"}
    if cmd == 'tor-window':
        why = ensure_daemon()
        if why:
            return {'error': why}
        spawn([sys.executable, os.path.realpath(__file__), '--tor-window'])
        return {'ok': True}
    if cmd == 'write-switches':
        return write_switches(msg.get('lines'))
    if cmd == 'uninstall':
        return {'error': 'On Linux, Goat is one AppImage file: close Goat and delete that file. Your data is in ~/.config/goat-browser'}
    return {'error': 'unknown command'}


def run_native():
    while True:
        try:
            msg = read_message()
        except (ValueError, OSError):
            send({'error': 'bad message'})
            continue
        if msg is None:
            return 0
        try:
            reply = handle(msg if isinstance(msg, dict) else {})
        except Exception as e:  # pylint: disable=broad-except
            reply = {'error': str(e)}
        if reply is not None:
            send(reply)


def watch_loop():
    last = None
    started = time.time()
    while True:
        st = query_tor(started)
        key = (st['state'], st['progress'], st['error'])
        if key != last:
            try:
                send(st)
            except OSError:
                return
        last = key
        time.sleep(5 if st['state'] == 'on' else 0.7)


def query_tor(since):
    r = control('GETINFO status/bootstrap-phase')
    if r is not None:
        m = re.search(r'PROGRESS=(\d+)', r)
        p = int(m.group(1)) if m else 0
        if p >= 100:
            return tor_status('on', 100)
        w = re.search(r'WARN BOOTSTRAP .*?SUMMARY="([^"]*)"', r)
        return tor_status('starting', p, 'Tor: ' + w.group(1) if w and time.time() - since > 20 else '')
    if os.path.exists(ERROR_FILE):
        err = open(ERROR_FILE, encoding='utf-8').read().strip()
        if err:
            return tor_status('error', 0, err)
    if not daemon_running() and time.time() - since > 10:
        return tor_status('error', 0, 'Tor stopped')
    return tor_status('starting', 0)


# ------------------------------------------------------------- Tor control
def control(command):
    try:
        cookie = open(os.path.join(DATA_ROOT, 'data', 'control_auth_cookie'), 'rb').read().hex()
        with socket.create_connection(('127.0.0.1', CONTROL_PORT), timeout=3) as s:
            f = s.makefile('rwb')
            f.write(f'AUTHENTICATE {cookie}\r\n'.encode())
            f.flush()
            if not f.readline().startswith(b'250'):
                return None
            f.write(command.encode() + b'\r\n')
            f.flush()
            out = []
            while True:
                line = f.readline().decode('utf-8', 'replace')
                if not line:
                    break
                out.append(line)
                if len(line) >= 4 and line[3] == ' ':
                    break
            f.write(b'QUIT\r\n')
            f.flush()
            return ''.join(out)
    except OSError:
        return None


def daemon_running():
    try:
        pid = int(open(PID_FILE).read().strip())
        os.kill(pid, 0)
        return open(f'/proc/{pid}/cmdline', 'rb').read().find(b'--tor-daemon') >= 0
    except (OSError, ValueError):
        return False


def spawn(argv):
    subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True, close_fds=True, cwd=GOAT_DIR)


def ensure_daemon():
    if not os.path.exists(TOR_EXE):
        return 'Tor is missing from this Goat build.'
    if daemon_running():
        return None
    try:
        os.remove(ERROR_FILE)
    except OSError:
        pass
    spawn([sys.executable, os.path.realpath(__file__), '--tor-daemon'])
    for _ in range(30):
        if daemon_running():
            break
        time.sleep(0.1)
    return None


def goat_running():
    prefix = APP_DIR.rstrip('/') + '/'
    for pid in os.listdir('/proc'):
        if not pid.isdigit():
            continue
        try:
            if os.readlink(f'/proc/{pid}/exe').startswith(prefix):
                return True
        except OSError:
            pass
    return False


def write_error(message):
    os.makedirs(DATA_ROOT, exist_ok=True)
    with open(ERROR_FILE, 'w', encoding='utf-8') as f:
        f.write(message)
    log(message)


def run_daemon():
    os.makedirs(os.path.join(DATA_ROOT, 'data'), mode=0o700, exist_ok=True)
    if daemon_running():
        return 0
    with open(PID_FILE, 'w') as f:
        f.write(str(os.getpid()))
    torrc = os.path.join(DATA_ROOT, 'torrc')
    geo = os.path.join(TOR_DIR, 'data')
    with open(torrc, 'w', encoding='utf-8') as f:
        f.write('\n'.join([
            f'SocksPort 127.0.0.1:{SOCKS_PORT}',
            f'ControlPort 127.0.0.1:{CONTROL_PORT}',
            'CookieAuthentication 1',
            'DataDirectory ' + os.path.join(DATA_ROOT, 'data'),
            'GeoIPFile ' + os.path.join(geo, 'geoip'),
            'GeoIPv6File ' + os.path.join(geo, 'geoip6'),
            'ClientOnly 1',
            'AvoidDiskWrites 1',
            'Log notice file ' + os.path.join(DATA_ROOT, 'tor.log'),
            f'__OwningControllerProcess {os.getpid()}',
        ]) + '\n')
    env = dict(os.environ)
    env['LD_LIBRARY_PATH'] = os.path.join(TOR_DIR, 'tor') + (':' + env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
    tor = None
    restarts = 0
    idle = 0
    try:
        while True:
            if tor is None or tor.poll() is not None:
                if tor is not None:
                    restarts += 1
                    if restarts > 3:
                        write_error(f'Tor keeps stopping (exit code {tor.returncode}). See {DATA_ROOT}/tor.log')
                        return 1
                try:
                    tor = subprocess.Popen([TOR_EXE, '-f', torrc], env=env, cwd=os.path.dirname(TOR_EXE),
                                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except OSError as e:
                    write_error(f"Couldn't start Tor: {e}")
                    return 1
            time.sleep(5)
            idle = 0 if goat_running() else idle + 1
            if idle >= 3:  # Goat closed: stop Tor
                tor.send_signal(signal.SIGTERM)
                return 0
    finally:
        try:
            os.remove(PID_FILE)
        except OSError:
            pass


# --------------------------------------------------------------- Tor window
def run_tor_window():
    if ensure_daemon():
        return 1
    profile = os.path.join(tempfile.gettempdir(), 'goat-tor-' + uuid.uuid4().hex)
    os.makedirs(os.path.join(profile, 'NativeMessagingHosts'), mode=0o700)
    # The throwaway profile needs to know where this helper is.
    src = os.path.join(CONFIG, 'NativeMessagingHosts', 'com.goat.host.json')
    if os.path.exists(src):
        shutil.copy(src, os.path.join(profile, 'NativeMessagingHosts'))
    launcher = os.path.join(os.environ['APPDIR'], 'AppRun') if os.environ.get('APPDIR') else os.path.join(APP_DIR, 'chrome')
    args = [
        launcher,
        f'--user-data-dir={profile}',
        f'--proxy-server=socks5://127.0.0.1:{SOCKS_PORT}',
        '--webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-background-networking',
        '--no-first-run',
        '--no-default-browser-check',
        '--new-window',
        f'chrome-extension://{EXTENSION_ID}/tor.html',
    ]
    try:
        subprocess.run(args, stdin=subprocess.DEVNULL, check=False)
    finally:
        for _ in range(60):
            time.sleep(1)
            try:
                shutil.rmtree(profile)
                break
            except FileNotFoundError:
                break
            except OSError:
                pass
    return 0


# ----------------------------------------------------------------- switches
ALLOWED_SWITCHES = {
    'fingerprinting-canvas-image-data-noise', 'fingerprinting-client-rects-noise',
    'fingerprinting-canvas-measuretext-noise', 'no-pings',
}
ALLOWED_FEATURES = {'SpoofWebGLInfo', 'RemoveClientHints', 'ReducedSystemInfo', 'MinimalReferrers'}


def write_switches(lines):
    if not isinstance(lines, list):
        return {'error': 'no lines'}
    keep = []
    for raw in lines:
        line = str(raw).strip()
        m = re.fullmatch(r'--([a-z0-9-]+)(?:=([A-Za-z0-9,]+))?', line)
        if not m:
            return {'error': 'bad switch ' + line}
        name, value = m.group(1), m.group(2)
        if name == 'enable-features':
            bad = [f for f in (value or '').split(',') if f not in ALLOWED_FEATURES]
            if bad or not value:
                return {'error': 'feature not allowed: ' + ','.join(bad)}
        elif name not in ALLOWED_SWITCHES or value is not None:
            return {'error': 'switch not allowed: ' + name}
        keep.append(line)
    os.makedirs(CONFIG, exist_ok=True)
    path = os.path.join(CONFIG, 'settings.switches')
    text = '# Written by Goat settings. Read at startup.\n' + '\n'.join(keep) + '\n'
    old = open(path, encoding='utf-8').read() if os.path.exists(path) else ''
    if old != text:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)
    return {'ok': True, 'changed': old != text}


def main():
    try:
        if '--tor-daemon' in sys.argv:
            return run_daemon()
        if '--tor-window' in sys.argv:
            return run_tor_window()
        return run_native()
    except Exception as e:  # pylint: disable=broad-except
        log(f'fatal: {e!r}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
