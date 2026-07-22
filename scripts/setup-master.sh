#!/usr/bin/env bash
# ==========================================================================
# Crea el primer empleado master usando el endpoint /api/setup.
# Uso: ./scripts/setup-master.sh <username> "<full_name>" "<password>"
# Requiere: SETUP_SECRET en .env.local y `npm run dev` corriendo.
# ==========================================================================
set -e

if [ "$#" -lt 3 ]; then
    echo "Uso: $0 <username> \"<full_name>\" <password> [position] [phone]"
    echo "Ej:  $0 admin \"Admin Principal\" MiClaveSegura2026"
    exit 1
fi

USERNAME="$1"
FULL_NAME="$2"
PASSWORD="$3"
POSITION="${4:-Administrador}"
PHONE="${5:-}"

if [ ! -f .env.local ]; then
    echo "ERROR: No se encontró .env.local"
    exit 1
fi

SETUP_SECRET=$(grep -E '^SETUP_SECRET=' .env.local | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
if [ -z "$SETUP_SECRET" ]; then
    echo "ERROR: SETUP_SECRET no está configurado en .env.local"
    echo "Genera uno con:  openssl rand -hex 32"
    exit 1
fi

HOST="${HOST:-http://localhost:3000}"

echo "Creando empleado master '$USERNAME' en $HOST/api/setup ..."

RESPONSE=$(curl -sS -X POST "$HOST/api/setup" \
    -H "Content-Type: application/json" \
    -H "x-setup-secret: $SETUP_SECRET" \
    -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\",\"full_name\":\"$FULL_NAME\",\"position\":\"$POSITION\",\"phone\":\"$PHONE\"}")

echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo ""
    echo "Listo. Ya puedes iniciar sesión en: $HOST/login"
    echo "  Usuario: $USERNAME"
    echo "  Contraseña: (la que acabas de poner)"
fi
