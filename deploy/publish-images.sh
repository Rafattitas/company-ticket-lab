#!/usr/bin/env bash
set -Eeuo pipefail

owner="${GITHUB_REPOSITORY_OWNER:?Missing GITHUB_REPOSITORY_OWNER}"
commit="${GITHUB_SHA:?Missing GITHUB_SHA}"
owner="${owner,,}"

for component in backend frontend postgres; do
  docker image inspect "company-ticket-${component}:ci" >/dev/null
done

for component in backend frontend postgres; do
  source_image="company-ticket-${component}:ci"
  target_image="ghcr.io/${owner}/company-ticket-${component}:sha-${commit}"

  echo "Publishing ${target_image}"
  docker tag "$source_image" "$target_image"
  docker push "$target_image"
done
