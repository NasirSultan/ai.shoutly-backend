#!/bin/bash
redis-server --daemonize yes --logfile /tmp/redis.log 2>/dev/null || true
sleep 1
exec node dist/main.js
