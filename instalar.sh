#!/usr/bin/env bash
# Tá Barato? — publica tabarato.ofertadorafa.com.br no Caddy (Docker) do painel achadinhos.
# Roda o app Node num container próprio (node:22-alpine) na mesma rede do Caddy.
# Não mexe no painel, no Natal nem no Casa Sem Apagão (só acrescenta um bloco no Caddyfile e um serviço no override).
# Uso: curl -fsSL https://raw.githubusercontent.com/rafaelgomes90/ta-barato/main/instalar.sh | sudo bash
set -euo pipefail

SITE="${DOMINIO_SITE:-tabarato.ofertadorafa.com.br}"
PROJ="/home/rafael/achadinhos"
WWW="/var/www/tabarato"
REPO="https://github.com/rafaelgomes90/ta-barato.git"
CADDYFILE="$PROJ/Caddyfile"
OVERRIDE="$PROJ/docker-compose.override.yml"
TOKENFILE="$PROJ/.tabarato_admin_token"
TS=$(date +%Y%m%d%H%M%S)

cd "$PROJ"
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
[ -f "$CADDYFILE" ] || { echo "!! Não achei $CADDYFILE"; exit 1; }
[ -f "$OVERRIDE" ] || { echo "!! Não achei $OVERRIDE"; exit 1; }

echo "==> Baixando/atualizando o código em $WWW"
command -v git >/dev/null || { apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git >/dev/null; }
git config --global --get-all safe.directory 2>/dev/null | grep -qx "$WWW" || git config --global --add safe.directory "$WWW"
if [ -d "$WWW/.git" ]; then git -C "$WWW" pull -q; else rm -rf "$WWW"; git clone -q "$REPO" "$WWW"; fi
chmod -R a+rX "$WWW"
mkdir -p "$PROJ/tabarato-data"

echo "==> Token admin (importação de ofertas)"
[ -s "$TOKENFILE" ] || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$TOKENFILE"
chmod 600 "$TOKENFILE"; TOKEN=$(cat "$TOKENFILE")

echo "==> Backup"
cp "$CADDYFILE" "$CADDYFILE.bak-$TS"
cp "$OVERRIDE" "$OVERRIDE.bak-$TS"

desfazer() {
  echo "!! Algo deu errado — voltando a configuração anterior"
  cat "$CADDYFILE.bak-$TS" > "$CADDYFILE"
  cat "$OVERRIDE.bak-$TS" > "$OVERRIDE"
  docker rm -f achadinhos-tabarato-1 >/dev/null 2>&1 || true
  $DC up -d --no-deps caddy >/dev/null 2>&1 || true
  $DC exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || $DC restart caddy
  exit 1
}

echo "==> Caddyfile: bloco do $SITE"
if ! grep -q "^$SITE" "$CADDYFILE"; then
  { cat "$CADDYFILE.bak-$TS"; cat <<CADDY

# Tá Barato? (app Node em container)
$SITE {
	encode gzip
	reverse_proxy tabarato:3000 {
		header_up X-Real-IP {remote_host}
	}
}
CADDY
  } > "$CADDYFILE.novo"
  cat "$CADDYFILE.novo" > "$CADDYFILE"; rm -f "$CADDYFILE.novo"
fi

echo "==> docker-compose.override.yml: serviço tabarato"
if ! grep -q "^  tabarato:" "$OVERRIDE"; then
  cat >> "$OVERRIDE" <<YML
  tabarato:
    image: node:22-alpine
    restart: unless-stopped
    working_dir: /app
    command: node src/server.mjs
    environment:
      - HOST=0.0.0.0
      - PORT=3000
      - ADMIN_IMPORT_TOKEN=$TOKEN
      - PUBLIC_ORIGIN=https://$SITE
      - TZ=America/Fortaleza
    volumes:
      - $WWW:/app:ro
      - ./tabarato-data:/app/data
YML
fi
chown rafael:rafael "$CADDYFILE" "$OVERRIDE" 2>/dev/null || true

echo "==> Validando"
$DC config -q || desfazer
DOM=$(grep -E '^DOMINIO=' .env | head -1 | cut -d= -f2- | tr -d "\"' ")
docker run --rm -e DOMINIO="$DOM" -v "$CADDYFILE:/etc/caddy/Caddyfile:ro" caddy:2 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null || desfazer

echo "==> Subindo o app e recarregando o Caddy (o painel não é tocado)"
$DC up -d --no-deps tabarato caddy || desfazer
sleep 4
if $DC exec -T caddy grep -q "tabarato:3000" /etc/caddy/Caddyfile 2>/dev/null; then
  $DC exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || $DC restart caddy
else
  echo "   Caddy com o arquivo antigo preso; reiniciando (uns segundos)"; $DC restart caddy
fi
sleep 5

# Atualização automática: puxa do GitHub a cada 5 min e reinicia o app só se houve mudança
cat > /etc/cron.d/tabarato <<CRON
*/5 * * * * root cd $WWW && OLD=\$(git rev-parse HEAD) && git pull -q >/dev/null 2>&1 && [ "\$OLD" != "\$(git rev-parse HEAD)" ] && chmod -R a+rX $WWW && cd $PROJ && $DC restart tabarato >/dev/null 2>&1
CRON

echo "==> Conferindo"
P=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --resolve "$DOM:443:127.0.0.1" "https://$DOM/" || echo 000)
E=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15 --resolve "energia.ofertadorafa.com.br:443:127.0.0.1" "https://energia.ofertadorafa.com.br/" || echo 000)
echo "   painel achadinhos: HTTP $P · Casa Sem Apagão: HTTP $E"
[ "$P" = "000" ] && desfazer
S=000
for i in 1 2 3 4 5 6; do
  S=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 --resolve "$SITE:443:127.0.0.1" "https://$SITE/" || echo 000)
  [ "$S" = "200" ] && break; sleep 10
done
H=$(curl -sk --max-time 15 --resolve "$SITE:443:127.0.0.1" "https://$SITE/api/health" || echo falhou)
echo "   Tá Barato: HTTP $S · /api/health: $H"
if [ "$S" = "200" ]; then
  echo
  echo "Pronto: https://$SITE"
else
  echo "Tudo instalado. O certificado do $SITE ainda não saiu: confira se o DNS já aponta pro IP da VPS."
  echo "Log: sudo docker logs --tail 30 achadinhos-caddy-1 ; sudo docker logs --tail 30 achadinhos-tabarato-1"
fi
echo "Token admin (guarde): $TOKEN"
