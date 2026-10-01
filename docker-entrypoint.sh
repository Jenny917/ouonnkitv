#!/bin/sh
set -eu

node /app/scripts/generate-runtime-config.mjs /usr/share/nginx/html/runtime-config.js

exec /usr/bin/supervisord -c /etc/supervisord.conf
