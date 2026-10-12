#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [ "${EUID}" -ne 0 ]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

read -r -s -p "Initial TicketDesk admin password (12+ characters): " password
echo
read -r -s -p "Confirm password: " confirmation
echo

if [ "$password" != "$confirmation" ]; then
  echo "Passwords do not match." >&2
  exit 1
fi

if [ "${#password}" -lt 12 ]; then
  echo "Password must contain at least 12 characters." >&2
  exit 1
fi

install -d -m 0700 -o root -g root /etc/company-ticket/secrets
temporary_file="$(mktemp /etc/company-ticket/secrets/ticketdesk_admin_password.XXXXXX)"
printf '%s' "$password" > "$temporary_file"
chown root:987 "$temporary_file"
chmod 0640 "$temporary_file"
mv -f "$temporary_file" /etc/company-ticket/secrets/ticketdesk_admin_password
echo "TicketDesk admin password configured. Initial username: admin"
