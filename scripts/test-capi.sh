#!/bin/bash
# test-capi.sh — Testa a Meta CAPI manualmente com curl
# Útil para validar token, pixel e payload sem precisar rodar o backend
#
# Uso:
#   export META_CAPI_ACCESS_TOKEN="EAAxxxxxxxx"
#   export META_CAPI_PIXEL_ID="123456789012345"
#   export META_CAPI_TEST_CODE="TEST12345"   # pegar no Events Manager > Test Events
#   ./test-capi.sh
#
# Verificar resultado: Events Manager > aba "Test Events" (tempo real)
#
# ATENÇÃO: evento com test_event_code NÃO é descartado. Ele aparece em Test Events
# e também entra nos dados do pixel (segmentação e mensuração). Use um pixel de
# teste ou mande poucos eventos.

set -euo pipefail

PIXEL_ID="${META_CAPI_PIXEL_ID:?Defina META_CAPI_PIXEL_ID}"
ACCESS_TOKEN="${META_CAPI_ACCESS_TOKEN:?Defina META_CAPI_ACCESS_TOKEN}"
TEST_CODE="${META_CAPI_TEST_CODE:-}"   # opcional

# Versão da Graph API. Cada versão vive cerca de 2 anos: confira a atual em
# https://developers.facebook.com/docs/graph-api/changelog/versions
API_VERSION="${META_GRAPH_API_VERSION:-v26.0}"
EVENT_SOURCE_URL="${META_CAPI_EVENT_SOURCE_URL:-https://seu-site.com}"

# SHA-256 em hex minúsculo (funciona no Linux, macOS e Git Bash)
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | cut -d' ' -f1
  else
    printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1
  fi
}

# Valores de teste (nunca usar dados reais aqui), já normalizados antes do hash:
#   email: trim + minúsculas
#   telefone: só dígitos, com DDI, SEM o "+" (regra do Meta)
#   nome: trim + minúsculas
TEST_EMAIL_HASH="$(sha256 'test@example.com')"   # 973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b
TEST_PHONE_HASH="$(sha256 '5511999999999')"      # a869177964cc68954ffec997bbad30769f8a5a6fdc60f296ddbc60b9347dc416
TEST_FN_HASH="$(sha256 'joao')"

EVENT_TIME=$(date +%s)
ORDER_ID="TEST-${EVENT_TIME}"
# event_id determinístico: o mesmo pedido gera sempre o mesmo ID
EVENT_ID="purchase_${ORDER_ID}"

TEST_CODE_FIELD=""
if [ -n "$TEST_CODE" ]; then
  TEST_CODE_FIELD=", \"test_event_code\": \"${TEST_CODE}\""
fi

PAYLOAD=$(cat <<JSON
{
  "data": [
    {
      "event_name": "Purchase",
      "event_time": ${EVENT_TIME},
      "event_id": "${EVENT_ID}",
      "action_source": "website",
      "event_source_url": "${EVENT_SOURCE_URL}",
      "user_data": {
        "em": ["${TEST_EMAIL_HASH}"],
        "ph": ["${TEST_PHONE_HASH}"],
        "fn": ["${TEST_FN_HASH}"],
        "client_ip_address": "177.100.200.50",
        "client_user_agent": "Mozilla/5.0 (test)"
      },
      "custom_data": {
        "value": 197.00,
        "currency": "BRL",
        "content_ids": ["produto-exemplo"],
        "content_type": "product",
        "num_items": 1,
        "order_id": "${ORDER_ID}"
      }
    }
  ]${TEST_CODE_FIELD}
}
JSON
)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Meta CAPI — Teste manual (${API_VERSION})"
echo "Pixel: $PIXEL_ID"
echo "Event ID: $EVENT_ID"
[ -n "$TEST_CODE" ] && echo "Test Code: $TEST_CODE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  "https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_CODE=$(printf '%s\n' "$RESPONSE" | tail -n 1)
BODY=$(printf '%s\n' "$RESPONSE" | sed '$d')

echo "Status: $HTTP_CODE"
echo "Resposta: $BODY"

if [ "$HTTP_CODE" = "200" ]; then
  echo ""
  echo "✓ Evento enviado com sucesso (esperado: \"events_received\": 1)"
  [ -n "$TEST_CODE" ] && echo "→ Verificar no Events Manager > Test Events"
else
  echo ""
  echo "✗ Erro ao enviar evento"
  echo "Erros da Graph API voltam com status 4xx e um objeto \"error\" no corpo."
  echo "Código 190 = token inválido ou expirado. Confira também o pixel ID e a versão da API."
  exit 1
fi
