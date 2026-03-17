#!/bin/bash
# test-capi.sh — Testa a Meta CAPI manualmente com curl
# Útil para validar token, pixel e payload sem precisar rodar o backend
#
# Uso:
#   export META_CAPI_ACCESS_TOKEN="EAAxxxxxxxx"
#   export META_CAPI_PIXEL_ID="762043xxxxxx"
#   export META_CAPI_TEST_CODE="TEST12345"   # pegar no Events Manager > Test Events
#   ./test-capi.sh
#
# Verificar resultado: Events Manager > aba "Test Events" (tempo real)

set -e

PIXEL_ID="${META_CAPI_PIXEL_ID:?Defina META_CAPI_PIXEL_ID}"
ACCESS_TOKEN="${META_CAPI_ACCESS_TOKEN:?Defina META_CAPI_ACCESS_TOKEN}"
TEST_CODE="${META_CAPI_TEST_CODE:-}"   # opcional

API_VERSION="v19.0"
EVENT_SOURCE_URL="${META_CAPI_EVENT_SOURCE_URL:-https://seu-site.com}"

# Valores de teste (nunca usar dados reais aqui)
EVENT_ID="test-$(date +%s)-$RANDOM"
EVENT_TIME=$(date +%s)

# SHA-256 de "test@example.com" (email de teste, já hasheado)
TEST_EMAIL_HASH="973dfe0d4e3a691bba4c61d4a5c50d7abd9ed4af4df8f1ddb84d5fe7abc94d0b"

# SHA-256 de "55119999988888" (telefone de teste E.164)
TEST_PHONE_HASH="ac7c9e93c9a7e6f7e47a9ea7f4e9c5e2b1a3d8f7e2c4b9a1e5d6c8f7b2a4e9c1"

# Monta o payload
PAYLOAD=$(cat <<EOF
{
  "data": [
    {
      "event_name": "Purchase",
      "event_time": ${EVENT_TIME},
      "event_id": "${EVENT_ID}",
      "action_source": "website",
      "event_source_url": "${EVENT_SOURCE_URL}",
      "user_data": {
        "em": "${TEST_EMAIL_HASH}",
        "ph": "${TEST_PHONE_HASH}",
        "fn": "7c211433f02071597741e6f5f6520d2d",
        "client_ip_address": "177.100.200.50",
        "client_user_agent": "Mozilla/5.0 (test)"
      },
      "custom_data": {
        "value": 47.90,
        "currency": "BRL",
        "content_ids": ["kit-completo"],
        "content_type": "product",
        "num_items": 1,
        "order_id": "TEST-${EVENT_TIME}"
      }
    }
  ]
  $([ -n "$TEST_CODE" ] && echo ', "test_event_code": "'"$TEST_CODE"'"')
}
EOF
)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Meta CAPI — Teste manual"
echo "Pixel: $PIXEL_ID"
echo "Event ID: $EVENT_ID"
[ -n "$TEST_CODE" ] && echo "Test Code: $TEST_CODE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  "https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "Status: $HTTP_CODE"
echo "Resposta: $BODY"

if [ "$HTTP_CODE" = "200" ]; then
  echo ""
  echo "✓ Evento enviado com sucesso"
  [ -n "$TEST_CODE" ] && echo "→ Verificar no Events Manager > Test Events"
else
  echo ""
  echo "✗ Erro ao enviar evento"
  echo "Verifique: token válido? pixel ID correto? permissão ads_management?"
  exit 1
fi
