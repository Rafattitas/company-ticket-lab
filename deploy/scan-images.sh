#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 BACKEND_IMAGE FRONTEND_IMAGE POSTGRES_IMAGE" >&2
  exit 2
fi

TRIVY_IMAGE="aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969"

scan() {
  docker run --rm \
    --user 0:0 \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --mount type=volume,src=company-ticket-trivy-cache,dst=/root/.cache \
    "$TRIVY_IMAGE" \
    image --image-src docker --scanners vuln --no-progress "$@"
}

gate() {
  local image="$1"
  shift

  echo "Fixable findings gate: $image"
  scan "$@" --severity HIGH,CRITICAL --ignore-unfixed --format json --exit-code 0 "$image" \
    | python3 -c '
import json
import sys

report = json.load(sys.stdin)
findings = [
    (result["Target"], vulnerability)
    for result in report.get("Results", [])
    for vulnerability in result.get("Vulnerabilities", [])
]

if findings:
    for target, vulnerability in findings:
        print(
            target,
            vulnerability["VulnerabilityID"],
            vulnerability["PkgName"],
            vulnerability["InstalledVersion"],
            "->",
            vulnerability.get("FixedVersion", "unknown"),
        )
    sys.exit(1)

print("No fixable HIGH or CRITICAL findings")
'
}

for image in "$@"; do
  echo "Full scan summary: $image"
  scan --severity HIGH,CRITICAL --format json --exit-code 0 "$image" \
    | python3 -c 'import json,sys; [print(r["Target"], "HIGH:", sum(v["Severity"]=="HIGH" for v in r.get("Vulnerabilities",[])), "CRITICAL:", sum(v["Severity"]=="CRITICAL" for v in r.get("Vulnerabilities",[]))) for r in json.load(sys.stdin)["Results"]]'
done

echo "Checking fixable HIGH and CRITICAL findings"
gate "$1"
gate "$2"
gate "$3" --pkg-types os
echo "Trivy gate passed; review PostgreSQL gosu findings separately."
