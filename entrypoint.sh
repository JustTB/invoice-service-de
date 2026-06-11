#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting invoice-service..."
exec node dist/index.js
