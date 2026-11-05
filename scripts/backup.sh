#!/usr/bin/env bash
# Backup do PostgreSQL + arquivos enviados. Uso: DATABASE_URL=... STORAGE_DIR=... ./scripts/backup.sh [pasta-destino]
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL}"
DEST="${1:-./backups}"; STAMP="$(date +%F-%H%M)"; mkdir -p "$DEST"
pg_dump --format=custom --file "$DEST/db-$STAMP.dump" "$DATABASE_URL"
if [ -d "${STORAGE_DIR:-}" ]; then tar -czf "$DEST/files-$STAMP.tgz" -C "$STORAGE_DIR" .; else echo "STORAGE_DIR ausente (se usa R2, ative o versionamento do bucket)."; fi
# Mantém os 14 backups mais recentes de cada tipo
ls -1t "$DEST"/db-*.dump 2>/dev/null | tail -n +15 | xargs -r rm --
ls -1t "$DEST"/files-*.tgz 2>/dev/null | tail -n +15 | xargs -r rm --
echo "Backup em $DEST (restaurar: pg_restore --clean --if-exists -d NOVO_BANCO $DEST/db-$STAMP.dump)"
