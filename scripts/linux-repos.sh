#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Our signed apt and dnf repositories (#113), built from Stable releases' .deb and .rpm files:
#
#   scripts/linux-repos.sh <packages-dir> <repo-dir>
#
# <packages-dir> holds the releases' Linux packages (qso-graph-desktop-<version>-linux-*.deb|rpm). The
# repository is written to <repo-dir>, new or empty, laid out as packages.qso-graph.net serves it:
#   rpm/x86_64/, rpm/aarch64/   each .rpm signed with rpmsign; createrepo_c's metadata, repomd.xml
#                               signed (repomd.xml.asc), for gpgcheck and repo_gpgcheck both
#   apt/pool/main/              the .deb files
#   apt/dists/stable/           Packages for amd64 and arm64; Release, signed as InRelease and Release.gpg
#   qso-graph-desktop.asc       the release key, armoured, for dnf's gpgkey= and for people
#   qso-graph-desktop.gpg       the same key, binary, for apt's signed-by=
#   qso-graph-desktop.repo      the file dnf users put in /etc/yum.repos.d/
#
# Signed with the release key (KI7MT, 2026-10-27), and only that key: SIGNING_KEY is its fingerprint,
# and the run stops unless the keyring in GNUPGHOME holds a secret key with exactly that fingerprint.
# PASSPHRASE_FILE holds its passphrase. The key itself is the caller's to import; nothing here prints it.
set -euo pipefail

in=${1:?usage: linux-repos.sh <packages-dir> <repo-dir>}
out=${2:?usage: linux-repos.sh <packages-dir> <repo-dir>}
key=${SIGNING_KEY:?SIGNING_KEY: the fingerprint of the release key}
pass=${PASSPHRASE_FILE:?PASSPHRASE_FILE: a file holding its passphrase}
[[ $key =~ ^[0-9A-F]{40}$ ]] || { echo "SIGNING_KEY is not a fingerprint: $key" >&2; exit 2; }
base=https://packages.qso-graph.net

# The key in the keyring is the release key, and it can sign.
have=$({ gpg --batch --with-colons --list-secret-keys "$key" 2>/dev/null || true; } | awk -F: '$1 == "fpr" { print $10; exit }')
[ "$have" = "$key" ] || { echo "The keyring holds no secret key $key." >&2; exit 1; }
echo "Signing with $key"
sign=(gpg --batch --yes --pinentry-mode loopback --passphrase-file "$pass" --local-user "$key")

shopt -s nullglob
debs=("$in"/qso-graph-desktop-*-linux-*.deb)
rpms=("$in"/qso-graph-desktop-*-linux-*.rpm)
[ ${#debs[@]} -gt 0 ] && [ ${#rpms[@]} -gt 0 ] || { echo "No .deb or no .rpm in $in." >&2; exit 1; }

mkdir -p "$out"
[ -z "$(ls -A "$out")" ] || { echo "$out is not empty: give a new or empty folder." >&2; exit 1; }

# dnf. Each .rpm signed in a copy: the release's own file is left as CI built it.
for arch in x86_64 aarch64; do mkdir -p "$out/rpm/$arch"; done
for file in "${rpms[@]}"; do
  name=$(basename "$file")
  case "$name" in
    *-linux-x86_64.rpm) arch=x86_64 ;;
    *-linux-aarch64.rpm) arch=aarch64 ;;
    *) echo "An .rpm for no architecture we serve: $name" >&2; exit 1 ;;
  esac
  cp "$file" "$out/rpm/$arch/$name"
  rpmsign --addsign \
    --define "__gpg $(command -v gpg)" \
    --define "_gpg_name $key" \
    --define "_gpg_sign_cmd_extra_args --batch --pinentry-mode loopback --passphrase-file $pass" \
    "$out/rpm/$arch/$name" >/dev/null
done
for arch in x86_64 aarch64; do
  createrepo_c --quiet "$out/rpm/$arch"
  "${sign[@]}" --armor --detach-sign --output "$out/rpm/$arch/repodata/repomd.xml.asc" "$out/rpm/$arch/repodata/repomd.xml"
done

# apt: one suite, stable, one component, main.
mkdir -p "$out/apt/pool/main"
cp "${debs[@]}" "$out/apt/pool/main/"
# Every package listed once, then split by architecture: apt-ftparchive's --arch lists nothing for
# these files.
(cd "$out/apt" && apt-ftparchive packages pool/main) > "$out/apt/Packages.all"
listed=0
for arch in amd64 arm64; do
  dir="$out/apt/dists/stable/main/binary-$arch"
  mkdir -p "$dir"
  awk -v arch="$arch" 'BEGIN { RS = ""; ORS = "\n\n" } $0 ~ ("\nArchitecture: " arch "\n") { print }' \
    "$out/apt/Packages.all" > "$dir/Packages"
  listed=$((listed + $(grep -c '^Package: ' "$dir/Packages" || true)))
  gzip -9nk "$dir/Packages"
done
rm "$out/apt/Packages.all"
[ "$listed" -eq ${#debs[@]} ] || { echo "The apt index lists $listed packages of ${#debs[@]}." >&2; exit 1; }
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin="QSO Graph" \
  -o APT::FTPArchive::Release::Label="QSO Graph Desktop" \
  -o APT::FTPArchive::Release::Suite=stable \
  -o APT::FTPArchive::Release::Codename=stable \
  -o APT::FTPArchive::Release::Architectures="amd64 arm64" \
  -o APT::FTPArchive::Release::Components=main \
  release "$out/apt/dists/stable" > "$out/apt/dists/stable/Release.tmp"
mv "$out/apt/dists/stable/Release.tmp" "$out/apt/dists/stable/Release"
"${sign[@]}" --clearsign --output "$out/apt/dists/stable/InRelease" "$out/apt/dists/stable/Release"
"${sign[@]}" --armor --detach-sign --output "$out/apt/dists/stable/Release.gpg" "$out/apt/dists/stable/Release"

# The key, and dnf's repository file.
gpg --batch --armor --export "$key" > "$out/qso-graph-desktop.asc"
gpg --batch --export "$key" > "$out/qso-graph-desktop.gpg"
cat > "$out/qso-graph-desktop.repo" <<EOF
[qso-graph-desktop]
name=QSO Graph Desktop
baseurl=$base/rpm/\$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=$base/qso-graph-desktop.asc
EOF

# Each signature verifies, before anything is uploaded.
gpg --batch --verify "$out/apt/dists/stable/InRelease" 2>/dev/null
gpg --batch --verify "$out/apt/dists/stable/Release.gpg" "$out/apt/dists/stable/Release" 2>/dev/null
for arch in x86_64 aarch64; do
  gpg --batch --verify "$out/rpm/$arch/repodata/repomd.xml.asc" "$out/rpm/$arch/repodata/repomd.xml" 2>/dev/null
done
db=$(mktemp -d)
rpm --dbpath "$db" --import "$out/qso-graph-desktop.asc"
for file in "$out"/rpm/*/*.rpm; do
  rpm --dbpath "$db" --checksig "$file" | grep -q 'digests signatures OK' || { echo "Not signed: $file" >&2; exit 1; }
done
rm -rf "$db"
echo "Built $out: ${#rpms[@]} .rpm, ${#debs[@]} .deb, every signature verified."
