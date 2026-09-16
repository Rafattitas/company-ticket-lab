# Image vulnerability scanning

GitHub Actions runs deploy/scan-images.sh after building the three images.
The script reports all HIGH and CRITICAL findings from Trivy.

The CI gate fails on HIGH or CRITICAL findings with a Fixed Version in:
- the Backend image;
- the Frontend image;
- OS packages in the PostgreSQL image.

PostgreSQL library findings are reported but are not part of the current gate.
On 2026-09-16, Trivy reported 21 HIGH and 1 CRITICAL findings in gosu.
The CRITICAL finding, CVE-2025-68121, concerns Go TLS session resumption.
gosu switches user during PostgreSQL startup; that TLS behavior appears
unrelated, but reachability has not been verified with govulncheck.

A passing gate is not approval to deploy to production. Review the gosu
findings, including reachability, before treating them as accepted risk.
Recheck all findings when base images or Trivy's vulnerability data change.

References:
- Go CVE details: https://github.com/golang/go/issues/77113
- gosu security policy: https://github.com/tianon/gosu/security
