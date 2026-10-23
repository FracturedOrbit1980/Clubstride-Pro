#!/usr/bin/env bash
# Creates the Android release keystore for Clubstride-Mobile.
#
# The password is read with echo off and handed to keytool through the environment, so it never
# lands in shell history or in a command-line argument that `ps` can see. This script does not
# write it anywhere: put it in a password manager before you close the terminal.
set -euo pipefail

cd "$(dirname "$0")/.."

KEYSTORE="secrets/clubstride-release.jks"
ALIAS="clubstride"
# Distinguished name of the signing certificate. Edit it to match your organisation - it is not
# shown to users, but it is baked into the artefact and Play App Signing records it.
DNAME="CN=Clubstride-Mobile, OU=Clubstride, O=Clubstride, L=Dublin, ST=Dublin, C=IE"

if ! command -v keytool >/dev/null; then
  echo "keytool not found. Install a JDK 17 or newer, then reopen the terminal." >&2
  exit 1
fi

if [ -e "$KEYSTORE" ]; then
  echo "$KEYSTORE already exists." >&2
  echo "Without Play App Signing, losing this file means losing the ability to ever update the"
  echo "app again. Move it aside on purpose - this script will not overwrite it." >&2
  exit 1
fi

mkdir -p secrets

read -rsp "Keystore password (also used for the key): " CS_RELEASE_KEYSTORE_PASSWORD
printf '\n'
read -rsp "Confirm password: " CS_RELEASE_KEYSTORE_PASSWORD_CONFIRM
printf '\n'
if [ "$CS_RELEASE_KEYSTORE_PASSWORD" != "$CS_RELEASE_KEYSTORE_PASSWORD_CONFIRM" ]; then
  echo "Passwords did not match. Nothing was written." >&2
  exit 1
fi
export CS_RELEASE_KEYSTORE_PASSWORD

# -keypass equal to -storepass: Gradle's signing config reads both, and the two being different
# is the most common cause of "Keystore was tampered with, or password was incorrect" on a build
# machine that has the right file.
keytool -genkeypair -v \
  -keystore "$KEYSTORE" \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10950 \
  -storetype JKS \
  -dname "$DNAME" \
  -storepass:env CS_RELEASE_KEYSTORE_PASSWORD \
  -keypass:env CS_RELEASE_KEYSTORE_PASSWORD

unset CS_RELEASE_KEYSTORE_PASSWORD CS_RELEASE_KEYSTORE_PASSWORD_CONFIRM

echo ""
echo "Wrote $KEYSTORE (alias $ALIAS)."
echo "Back it up off this machine, then register it with EAS:"
echo "    eas credentials --platform android"
echo "or let EAS generate and hold the keystore instead, and delete this file."
