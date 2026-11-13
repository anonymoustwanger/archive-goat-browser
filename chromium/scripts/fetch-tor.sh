#!/usr/bin/env bash
# Downloads the latest stable Tor Expert Bundle into $1/tor, after checking it
# against the sums file signed by the Tor Browser team.
# $2: windows-x86_64 (default) or linux-x86_64
set -euo pipefail

OUT="$1"
PLATFORM="${2:-windows-x86_64}"
EXE="tor.exe"; [ "$PLATFORM" = "${PLATFORM#windows}" ] && EXE="tor"
DIST="https://dist.torproject.org/torbrowser"
# Tor Browser Developers (signing key) <torbrowser@torproject.org>
FPR="EF6E286DDA85EA2A4BA7DE684E2C6E8793298290"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ver="$(curl -fsSL "$DIST/" | grep -oE 'href="[0-9]+(\.[0-9]+)+/"' | grep -oE '[0-9]+(\.[0-9]+)+' | sort -V | tail -1)"
[ -n "$ver" ] || { echo "fetch-tor: no Tor Browser release found at $DIST" >&2; exit 1; }
file="tor-expert-bundle-$PLATFORM-$ver.tar.gz"
echo "fetch-tor: Tor Browser $ver -> $file"

curl -fsSL -o "$WORK/$file" "$DIST/$ver/$file"
curl -fsSL -o "$WORK/sums.txt" "$DIST/$ver/sha256sums-signed-build.txt"
curl -fsSL -o "$WORK/sums.txt.asc" "$DIST/$ver/sha256sums-signed-build.txt.asc"

export GNUPGHOME="$WORK/gnupg"
mkdir -m 700 "$GNUPGHOME"
curl -fsSL "https://keys.openpgp.org/vks/v1/by-fingerprint/$FPR" | gpg --batch --quiet --import
status="$(gpg --batch --status-fd 1 --verify "$WORK/sums.txt.asc" "$WORK/sums.txt" 2>/dev/null || true)"
# VALIDSIG <signing key> ... <primary key>: the primary key must be the pinned one.
echo "$status" | grep -E "^\[GNUPG:\] VALIDSIG .* $FPR\$" >/dev/null || { echo "fetch-tor: bad signature on the sums file" >&2; echo "$status" >&2; exit 1; }

want="$(grep -E "  $file\$" "$WORK/sums.txt" | cut -d' ' -f1)"
got="$(sha256sum "$WORK/$file" | cut -d' ' -f1)"
[ -n "$want" ] && [ "$want" = "$got" ] || { echo "fetch-tor: checksum mismatch for $file" >&2; exit 1; }

mkdir -p "$OUT/tor"
tar -xzf "$WORK/$file" -C "$OUT/tor"
[ -f "$OUT/tor/tor/$EXE" ] || { echo "fetch-tor: $EXE not in the bundle (layout changed?)" >&2; ls -R "$OUT/tor" >&2; exit 1; }
[ -f "$OUT/tor/data/geoip" ] || echo "fetch-tor: warning, no geoip file in the bundle" >&2
echo "$ver" > "$OUT/tor/VERSION"
echo "fetch-tor: ok"
