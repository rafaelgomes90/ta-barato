#!/usr/bin/env bash
# Tá Barato? — instala/atualiza o app Node na VPS atrás do Caddy (HTTPS automático).
# Uso: curl -fsSL https://raw.githubusercontent.com/rafaelgomes90/ta-barato/main/instalar.sh | sudo DOMINIO=tabarato.ofertadorafa.com.br bash
set -euo pipefail

REPO="https://github.com/rafaelgomes90/ta-barato.git"
DIR="/opt/tabarato"
DOMINIO="${DOMINIO:?defina DOMINIO=seu.subdominio}"
CADDYFILE="/etc/caddy/Caddyfile"
PORTA=3000

systemctl is-active --quiet caddy || { echo "!! Caddy não está rodando (systemctl)."; exit 1; }
[ -f "$CADDYFILE" ] || { echo "!! Não achei $CADDYFILE"; exit 1; }
ss -ltn | grep -q "127.0.0.1:$PORTA " && ! systemctl is-active --quiet tabarato && { echo "!! Porta $PORTA já está em uso por outro serviço."; exit 1; } || true

echo "==> Node 22+"
need_node=1
if command -v node >/dev/null; then
  v=$(node -p 'process.versions.node'); 
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a==22&&b>=13)?0:1)' && need_node=0
fi
if [ "$need_node" = 1 ]; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates git >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
fi
node -v

echo "==> Código"
command -v git >/dev/null || { apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git >/dev/null; }
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q; else git clone -q "$REPO" "$DIR"; fi
mkdir -p "$DIR/data"

echo "==> .env"
if [ ! -f "$DIR/.env" ]; then
  TOKEN=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  cat > "$DIR/.env" <<ENV
PORT=$PORTA
HOST=127.0.0.1
ADMIN_IMPORT_TOKEN=$TOKEN
MERCADOLIVRE_ACCESS_TOKEN=
SHOPEE_APP_ID=
SHOPEE_SECRET=
PUBLIC_ORIGIN=https://$DOMINIO
ENV
  chmod 600 "$DIR/.env"
fi

echo "==> Serviço systemd"
id -u tabarato >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin tabarato
chown -R tabarato:tabarato "$DIR"
cat > /etc/systemd/system/tabarato.service <<UNIT
[Unit]
Description=Ta Barato (Oferta do Rafa)
After=network.target

[Service]
User=tabarato
WorkingDirectory=$DIR
ExecStart=$(command -v node) --env-file=$DIR/.env src/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable tabarato >/dev/null 2>&1
systemctl restart tabarato

echo "==> Caddy ($DOMINIO)"
cp "$CADDYFILE" "$CADDYFILE.bak-$(date +%Y%m%d%H%M%S)"
if ! grep -q "^$DOMINIO" "$CADDYFILE"; then
  cat >> "$CADDYFILE" <<CADDY

$DOMINIO {
	encode gzip
	reverse_proxy 127.0.0.1:$PORTA {
		header_up X-Real-IP {remote_host}
	}
}
CADDY
fi
caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null
systemctl reload caddy

echo "==> Atualização automática (a cada 5 min)"
echo "*/5 * * * * root cd $DIR && git pull -q 2>&1 | grep -q 'Already up to date' || systemctl restart tabarato" > /etc/cron.d/tabarato

sleep 2
curl -s -o /dev/null -w "app local: HTTP %{http_code}\n" "http://127.0.0.1:$PORTA/"
echo "Pronto: https://$DOMINIO (certificado sai em alguns segundos)"
echo "Token admin (guarde): $(grep ^ADMIN_IMPORT_TOKEN $DIR/.env | cut -d= -f2)"
