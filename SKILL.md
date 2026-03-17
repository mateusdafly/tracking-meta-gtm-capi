---
name: tracking-meta-gtm-capi
description: Use when implementing conversion tracking with Meta Pixel, Meta Conversions API (CAPI) server-side, Google Tag Manager, and Data Layer — including dual-channel event deduplication, PII hashing, fbp/fbc cookie forwarding, and full-funnel GTM tag/trigger/variable setup.
---

# Tracking Full-Stack: Meta Pixel + CAPI + GTM + Data Layer

## Overview

GTM é o hub central: todos os pixels (Meta, GA4, etc.) disparam como tags GTM a partir de eventos no `window.dataLayer`. O backend envia os mesmos eventos via **Meta Conversions API (CAPI) server-side** para garantir rastreamento mesmo com ad blockers, Safari ITP ou usuários que fecham a aba antes da confirmação.

**Princípio crítico:** o mesmo `event_id` deve fluir por TODOS os canais. Sem isso, o Meta conta duplicatas ou perde conversões.

## Setup: index.html

**Ordem obrigatória** — GTM primeiro, Meta Pixel base code depois:

```html
<head>
  <!-- 1. Google Tag Manager (primeiro) -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','GTM-XXXXXXX');</script>

  <!-- 2. Meta Pixel Base Code (depois do GTM) -->
  <script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', 'SEU_PIXEL_ID');
  fbq('track', 'PageView');</script>
</head>
<body>
  <!-- GTM noscript (logo após body) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
```

## Padrão de Data Layer Push

**SEMPRE limpar `ecommerce` antes de cada evento de e-commerce.** Dois pushes separados por evento: um GA4 (snake_case dentro de `ecommerce`) e um Meta (PascalCase no topo):

```js
// GA4
window.dataLayer.push({ ecommerce: null })
window.dataLayer.push({
  event: 'purchase',
  ecommerce: { transaction_id: 'PAY_123', value: 47.90, currency: 'BRL',
    items: [{ item_id: 'kit-completo', item_name: 'Kit Premium', price: 47.90, quantity: 1 }] }
})

// Meta (push separado, mesmo checkout)
window.dataLayer.push({
  event: 'Purchase',           // PascalCase para Meta
  value: 47.90, currency: 'BRL',
  content_ids: ['kit-completo'], content_type: 'product', num_items: 1,
  transaction_id: 'PAY_123', payment_method: 'PIX',
  event_id: 'uuid-gerado-no-frontend',  // CRÍTICO: mesmo ID que vai ao CAPI
  user: { email: 'sha256...', fn: 'sha256...', ph: 'sha256...' }  // PII hasheado
})
```

> Ver exemplos completos: `scripts/frontend-tracking.ts` (TypeScript/React) e `scripts/gtm-datalayer-vanilla.js` (Vanilla JS)

## PII: O que Hashear (SHA-256 + trim + lowercase)

| Hashear | Campo CAPI | Não hashear | Campo CAPI |
|---|---|---|---|
| email | `em` | Cookie `_fbp` | `fbp` |
| primeiro nome | `fn` | Cookie `_fbc` | `fbc` |
| último nome | `ln` | IP do cliente | `client_ip_address` |
| telefone (E.164) | `ph` | User-Agent | `client_user_agent` |
| cidade | `ct` | | |
| estado | `st` | | |
| país | `country` | | |
| ID interno | `external_id` | | |

**Telefone Brasil → E.164:** strips não-dígitos, adiciona `55` se 10 ou 11 dígitos.

> Ver regras completas e código: `pii-hashing.md`

## Meta CAPI Backend

```typescript
// Endpoint: POST https://graph.facebook.com/v19.0/{PIXEL_ID}/events
// Auth: ?access_token=TOKEN (query param, não header)

const payload = {
  data: [{
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    event_id: 'uuid-do-frontend',          // mesmo do browser pixel
    action_source: 'website',
    event_source_url: 'https://seu-site.com',
    user_data: {
      em: hash(email), fn: hash(fn), ph: hash(phone_e164),
      external_id: hash(userId),
      fbp: rawCookie, fbc: rawCookie,      // sem hash
      client_ip_address: req.ip,           // sem hash
      client_user_agent: req.headers['user-agent'] // sem hash
    },
    custom_data: { value: 47.90, currency: 'BRL', content_ids: ['kit-completo'] }
  }],
  test_event_code: process.env.META_CAPI_TEST_CODE  // undefined em prod
}
```

**Fire-and-forget — nunca bloquear a resposta HTTP:**
```typescript
sendCAPIEvent(...).catch(err => console.error('[CAPI] erro:', err))
res.json({ success: true })  // retorna imediatamente
```

> Implementação completa: `scripts/backend-capi.ts` | Guia completo: `meta-capi-backend.md`

## Deduplicação com event_id

```
Frontend                  Backend                    Meta
  │ gera eventId (UUID)      │                          │
  │──POST /create-payment───>│ salva capiEventId no DB  │
  │                          │──CAPI InitiateCheckout──>│ (eventId)
  │                          │──CAPI AddPaymentInfo────>│ (eventId)
  │ fbq('InitiateCheckout', {}, {eventID})──────────────>│ (mesmo eventId)
  │◄── polling status ───────│                          │
  │ fbq('Purchase', {}, {eventID})──────────────────────>│ (mesmo eventId)
  │                          │──CAPI Purchase (polling)>│ (mesmo eventId)
  │         webhook──────────>│                          │
  │                          │──CAPI Purchase (webhook)>│ (mesmo eventId)
```

**Purchase em 3 canais é intencional** — garante delivery se o usuário fecha a aba. Meta deduplica pelo mesmo `event_id` na janela de 48h. Salve `capiEventId, fbp, fbc, ipAddress, userAgent` no banco no momento do checkout para reutilizar no webhook.

> Diagrama completo e decisões de design: `architecture.md`

## Configuração GTM

**Variáveis DLV (Data Layer Variables) necessárias:**
`event_id` · `value` · `currency` · `content_ids` · `content_name` · `content_type` · `num_items` · `transaction_id` · `payment_method` · `user` (objeto completo)

**Triggers CE (Custom Event):**
`Purchase` · `InitiateCheckout` · `AddPaymentInfo` · `CompleteRegistration` · `ViewContent` · `purchase` · `begin_checkout`

**Tag Meta — 4º argumento do fbq() é OBRIGATÓRIO:**
```html
<script>
  fbq('track', 'Purchase', {
    value: {{DLV - value}}, currency: {{DLV - currency}},
    content_ids: {{DLV - content_ids}}, content_type: {{DLV - content_type}},
  }, {
    eventID: {{DLV - event_id}}   <!-- sem isso, deduplicação não funciona -->
  });
</script>
```

> Configuração completa (todas as tags, triggers e variáveis): `gtm-setup.md`

## Mapa de Eventos por Funil

| Etapa | Event Name | Browser (GTM) | CAPI Backend |
|---|---|---|---|
| Login/Cadastro | `CompleteRegistration` | ✅ | ✅ |
| Ver produto | `ViewContent` | ✅ | ❌ (browser suficiente) |
| Abrir checkout | `InitiateCheckout` | ✅ | ✅ |
| Preencher form | `AddPaymentInfo` | ✅ | ✅ |
| Pagamento confirmado | `Purchase` | ✅ | ✅ polling + ✅ webhook |

## Variáveis de Ambiente

```bash
META_CAPI_ACCESS_TOKEN=EAAxxxxx   # System User Token (ads_management)
META_CAPI_PIXEL_ID=762043xxxxxx   # ID do pixel
META_CAPI_TEST_CODE=TEST12345     # Só em dev/staging — remover em prod
```

Token: Meta Business Suite → Configurações → Usuários do Sistema → criar usuário sistema com permissão `ads_management`.

## Erros Comuns

| Erro | Causa | Fix |
|---|---|---|
| `fbq is not defined` | Pixel base code ausente | Adicionar antes do `</head>`, depois do GTM |
| Eventos duplicados no Events Manager | `event_id` diferente por canal | Frontend é a fonte de verdade — nunca gerar novo no backend |
| EMQ baixo (< 5) | Poucas informações de matching | Coletar telefone; verificar normalização E.164 |
| `ecommerce` do evento anterior presente | Faltou `{ ecommerce: null }` | Sempre limpar antes do push de e-commerce |
| CAPI não dispara no webhook | `capiEventId` null no banco | Verificar se checkout está salvando o campo |
| PII em texto claro nos logs | `user_data` logado completo | Logar só `event_name` + `event_id` — nunca `user_data` |

## Documentos de Apoio

- `architecture.md` — Por que dual-channel, trade-offs, ordem de deploy
- `datalayer-patterns.md` — Catálogo completo de eventos, anti-patterns
- `meta-capi-backend.md` — API CAPI completa: auth, payload, EMQ, Test Events
- `gtm-setup.md` — Passo a passo de configuração do container GTM
- `pii-hashing.md` — Regras de hashing, normalização, código browser e backend
- `mcp-integrations.md` — MCPs e APIs para Meta, GTM e GA4 com Claude
- `validation-testing.md` — Test Events, GTM Preview, checklist de produção

## Scripts

- `scripts/frontend-tracking.ts` — Módulo TypeScript completo (React/SPA)
- `scripts/backend-capi.ts` — Serviço CAPI Node.js completo
- `scripts/gtm-datalayer-vanilla.js` — Exemplos Vanilla JS para qualquer stack
- `scripts/test-capi.sh` — Curl para testar CAPI manualmente sem código
- `scripts/debug-datalayer.js` — Cola no console do browser para inspecionar pushes
