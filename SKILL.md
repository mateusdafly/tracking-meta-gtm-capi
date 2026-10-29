---
name: tracking-meta-gtm-capi
description: Use when implementing conversion tracking with Meta Pixel, Meta Conversions API (CAPI) server-side, Google Tag Manager, and Data Layer, including dual-channel event deduplication, PII hashing, fbp/fbc cookie forwarding, full-funnel GTM tag/trigger/variable setup, and sending sales that close in a CRM back to Meta and Google Ads (UTMs and click IDs captured on the site, stored on the lead, and returned with the purchase via CAPI and the Google Data Manager API).
---

# Tracking Full-Stack: Meta Pixel + CAPI + GTM + Data Layer + CRM

## Overview

GTM é o hub central: todos os pixels (Meta, GA4 etc.) disparam como tags GTM a partir de eventos no `window.dataLayer`. O backend envia os mesmos eventos pela **Meta Conversions API (CAPI) server-side**, para o rastreamento funcionar mesmo com ad blocker, Safari ITP ou usuário que fecha a aba antes da confirmação.

**Princípio crítico:** o mesmo `event_id` (com o mesmo `event_name`) tem que passar por TODOS os canais. Sem isso, o Meta conta duplicado ou perde conversão.

**Venda que fecha fora do site** (WhatsApp, telefone, vendedor, CRM): ver `crm-utms-e-vendas.md`. Lá estão as regras de passar UTMs e IDs de clique para o CRM e de mandar a venda de volta para o Meta e o Google na campanha certa.

## Setup: index.html

O snippet do GTM e o código base do pixel vão no `<head>`. O stub do `fbq` é criado na hora em que o código base roda, e o container do GTM carrega de forma assíncrona, então as tags do GTM sempre encontram o `fbq`. O que não pode é uma tag chamar `fbq` numa página sem o código base.

```html
<head>
  <!-- 1. Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','GTM-XXXXXXX');</script>

  <!-- 2. Meta Pixel Base Code -->
  <script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', 'SEU_PIXEL_ID');
  fbq('track', 'PageView');</script>

  <!-- 3. Captura de origem (UTMs + fbclid/gclid), se a venda fecha no CRM -->
  <script src="/js/captura-origem.js"></script>
</head>
<body>
  <!-- GTM noscript (logo após body) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
```

## Padrão de Data Layer Push

**Um ID por checkout.** Gere o `checkoutId` uma vez quando o checkout abre, guarde no estado, mande ao backend no POST que cria o pagamento e use o mesmo valor como `event_id` em InitiateCheckout, AddPaymentInfo e Purchase. O Meta deduplica por `event_name` + `event_id`, então reaproveitar o ID em eventos de nomes diferentes é seguro.

**SEMPRE limpar `ecommerce` antes de cada evento de e-commerce.** Dois pushes por evento: um GA4 (snake_case dentro de `ecommerce`) e um Meta (PascalCase no topo):

```js
// Quando o checkout abre
const checkoutId = crypto.randomUUID()
// ... POST /checkout { checkoutId, ... } → o backend salva como capiEventId

// GA4
window.dataLayer.push({ ecommerce: null })
window.dataLayer.push({
  event: 'purchase',
  ecommerce: { transaction_id: 'PAY_123', value: 197.00, currency: 'BRL',
    items: [{ item_id: 'produto-exemplo', item_name: 'Produto Exemplo', price: 197.00, quantity: 1 }] }
})

// Meta (push separado, mesmo checkout)
window.dataLayer.push({
  event: 'Purchase',           // PascalCase para Meta
  value: 197.00, currency: 'BRL',
  content_ids: ['produto-exemplo'], content_type: 'product', num_items: 1,
  transaction_id: 'PAY_123', payment_method: 'PIX',
  event_id: checkoutId,        // CRÍTICO: o mesmo ID que o backend usa na CAPI
})
```

> Ver exemplos completos: `scripts/frontend-tracking.ts` (TypeScript/React) e `scripts/gtm-datalayer-vanilla.js` (Vanilla JS)

## PII: O que Hashear (SHA-256 depois de normalizar)

| Hashear | Campo CAPI | Não hashear | Campo CAPI |
|---|---|---|---|
| email (trim + minúsculas) | `em` | Cookie `_fbp` | `fbp` |
| primeiro nome | `fn` | Click ID `fbc` | `fbc` |
| último nome | `ln` | IP do cliente | `client_ip_address` |
| telefone (só dígitos, com DDI) | `ph` | User-Agent | `client_user_agent` |
| cidade | `ct` | ID do lead (Lead Ads) | `lead_id` |
| estado | `st` | | |
| país | `country` | | |
| ID interno | `external_id` | | |

**Telefone para o Meta:** só dígitos, com DDI, **sem** o "+" (`5511999999999`). O "+" muda o hash e o telefone deixa de casar. **Para o Google é o contrário:** E.164 **com** o "+" (`+5511999999999`). Ver `pii-hashing.md`.

**`external_id`:** mande com hash nos dois canais (navegador e servidor). Se um manda cru e o outro com hash, os valores não batem.

> Ver regras completas e código: `pii-hashing.md`

## Meta CAPI Backend

```typescript
// Endpoint: POST https://graph.facebook.com/v26.0/{PIXEL_ID}/events
// Auth: ?access_token=TOKEN (query param). Nunca logue a URL.
// Versão: cada versão da Graph API vive cerca de 2 anos. Confira a atual em
// https://developers.facebook.com/docs/graph-api/changelog/versions

const payload = {
  data: [{
    event_name: 'Purchase',
    event_time: Math.floor(confirmedAt.getTime() / 1000), // hora REAL da venda, no máx. 7 dias atrás
    event_id: payment.capiEventId,         // o checkoutId salvo no banco
    action_source: 'website',
    event_source_url: 'https://seu-site.com/checkout',
    user_data: {
      em: hash(email), fn: hash(fn), ph: hash(phoneDigits),
      external_id: hash(userId),
      fbp: rawCookie, fbc: rawCookie,      // sem hash
      client_ip_address: req.ip,           // sem hash
      client_user_agent: req.headers['user-agent'] // sem hash, obrigatório para website
    },
    custom_data: { value: 197.00, currency: 'BRL', content_ids: ['produto-exemplo'] }
  }],
  test_event_code: process.env.META_CAPI_TEST_CODE  // undefined em prod
}
```

**Fire-and-forget: nunca bloquear a resposta HTTP:**
```typescript
sendCAPIEvent(...).catch(err => console.error('[CAPI] erro:', err))
res.json({ success: true })  // retorna imediatamente
```

Em serverless (Vercel, Lambda, Cloud Run com CPU só na requisição), trabalho depois da resposta pode ser cortado. Use `waitUntil` da plataforma ou uma fila.

> Implementação completa: `scripts/backend-capi.ts` | Guia completo: `meta-capi-backend.md`

## Deduplicação com event_id

O Meta deduplica quando **`event_name` e `event_id` batem**, dentro de 48 h a partir do primeiro evento recebido.

```
Frontend                  Backend                    Meta
  │ gera checkoutId (UUID)   │                          │
  │──POST /create-payment───>│ salva capiEventId no DB  │
  │                          │──CAPI InitiateCheckout──>│ (checkoutId)
  │                          │──CAPI AddPaymentInfo────>│ (checkoutId)
  │ fbq('InitiateCheckout', {}, {eventID: checkoutId})──>│
  │◄── polling status ───────│                          │
  │ fbq('Purchase', {}, {eventID: checkoutId})──────────>│
  │                          │──CAPI Purchase (polling)>│ (checkoutId)
  │         webhook──────────>│                          │
  │                          │──CAPI Purchase (webhook)>│ (checkoutId)
```

**Purchase em 3 canais é intencional:** garante a entrega se o usuário fecha a aba. Salve `capiEventId, fbp, fbc, ipAddress, userAgent` no banco no momento do checkout para reutilizar no webhook. Pedido antigo sem `capiEventId`: use `purchase_{orderId}`, que todos os canais conseguem calcular igual. Nunca gere um UUID novo no navegador na hora do Purchase.

> Diagrama completo e decisões de design: `architecture.md`

## Configuração GTM

**Variáveis DLV (Data Layer Variables) necessárias:**
`event_id` · `value` · `currency` · `content_ids` · `content_name` · `content_type` · `num_items` · `transaction_id` · `payment_method` · `user` (objeto completo)

**Triggers CE (Custom Event):**
`user_identified` · `Lead` · `Purchase` · `InitiateCheckout` · `AddPaymentInfo` · `CompleteRegistration` · `ViewContent` · `purchase` · `begin_checkout`

**Tag Meta: o 4º argumento do fbq() é OBRIGATÓRIO:**
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

**Advanced Matching:** o objeto `user` do dataLayer só vira dado de correspondência se uma tag passar ele para o pixel. Ver a tag "Meta - Advanced Matching" em `gtm-setup.md`.

**Tags GA4:** use a tag nativa "Evento do Google Analytics: GA4" com "Enviar dados de comércio eletrônico" marcado e origem "Camada de dados". Ela lê o objeto `ecommerce` sozinha.

> Configuração completa (todas as tags, triggers e variáveis): `gtm-setup.md`

## Mapa de Eventos por Funil

| Etapa | Event Name | Browser (GTM) | CAPI Backend |
|---|---|---|---|
| Lead (formulário) | `Lead` | ✅ | ✅ (`lead_{idLead}`) |
| Login/Cadastro | `CompleteRegistration` | ✅ | ✅ |
| Ver produto | `ViewContent` | ✅ | ❌ (browser suficiente) |
| Abrir checkout | `InitiateCheckout` | ✅ | ✅ |
| Preencher form | `AddPaymentInfo` | ✅ | ✅ |
| Pagamento confirmado | `Purchase` | ✅ | ✅ polling + ✅ webhook |
| Venda fechada no CRM | `Purchase` | ❌ | ✅ `scripts/enviar-venda-crm.ts` |

## Venda que fecha no CRM (resumo)

1. **Anúncios com UTMs de ID:** `utm_campaign={{campaign.id}}` no Meta, `{campaignid}` no Google. ID não muda quando a campanha é renomeada.
2. **Site guarda o rastro:** `scripts/captura-origem.js` guarda UTMs, `fbclid` (já como `fbc`) e `gclid`/`gbraid`/`wbraid` por 90 dias e preenche os campos ocultos do formulário.
3. **CRM guarda no lead:** um campo personalizado para cada valor.
4. **Venda volta:** `scripts/enviar-venda-crm.ts` manda o Purchase para o Meta com `fbc`, telefone e email (é isso que acha a campanha) e as UTMs em `custom_data` (relatório). Para o Google, usa a Data Manager API com `gclid`, telefone e email.

**O ID da campanha não atribui.** Quem liga a venda ao anúncio é o clique (`fbc`, `gclid`) e os dados do contato. A UTM serve para o CRM e para conferir com o painel.

> Guia completo: `crm-utms-e-vendas.md`

## Variáveis de Ambiente

```bash
# Meta
META_CAPI_ACCESS_TOKEN=EAAxxxxx   # Events Manager > pixel > Configurações > Conversions API > Gerar token
META_CAPI_PIXEL_ID=123456789012345
META_CAPI_TEST_CODE=TEST12345     # Só em dev/staging. Remover em prod
META_GRAPH_API_VERSION=v26.0      # opcional

# Google (só para venda que fecha no CRM)
GOOGLE_ADS_CUSTOMER_ID=1234567890
GOOGLE_ADS_CONVERSION_ACTION_ID=987654321   # ação do tipo "Importar de cliques"
GOOGLE_ADS_LOGIN_CUSTOMER_ID=               # se o acesso for por MCC
GOOGLE_DATAMANAGER_VALIDATE_ONLY=true       # primeiro teste: valida sem gravar
```

**Token do Meta:** gere em Events Manager > seu pixel > Configurações > Conversions API > "Gerar token de acesso", ou com um usuário do sistema do Business Manager com acesso ao pixel.

## Erros Comuns

| Erro | Causa | Fix |
|---|---|---|
| `fbq is not defined` | Pixel base code ausente na página | Colocar o código base no `<head>` de todas as páginas |
| Compras em dobro no Events Manager | `event_id` diferente por canal (ex: UUID novo no navegador na hora do Purchase) | Um `checkoutId` por checkout, salvo no backend e usado em todos os canais |
| EMQ baixo (< 5) | Poucas informações de matching | Coletar telefone; telefone sem "+" para o Meta; mandar `fbc` |
| Telefone não casa vindo do navegador | Hash feito com "+" no navegador e sem "+" no servidor | Mesma normalização nos dois lados (`normalizePhone`) |
| `fbc` inválido | `fbclid` cru mandado como `fbc` | Formato `fb.1.{timestamp_ms}.{fbclid}`, sem mudar maiúsculas |
| `ecommerce` do evento anterior presente | Faltou `{ ecommerce: null }` | Sempre limpar antes do push de e-commerce |
| CAPI não dispara no webhook | `capiEventId` null no banco | Verificar se checkout está salvando o campo |
| Requisição inteira recusada | Algum `event_time` com mais de 7 dias | Mandar as vendas no dia; venda presencial (`physical_store`) aceita até 62 dias |
| Venda do CRM sem campanha | Lead sem `fbc`/`gclid` e sem telefone/email | Capturar na primeira página (`captura-origem.js`) e guardar no lead |
| Dados de teste em produção | `test_event_code` não descarta o evento: ele entra nos dados do pixel | Poucos testes, ou pixel de teste |
| PII em texto claro nos logs | `user_data` logado completo | Logar só `event_name` + `event_id`, nunca `user_data` |

## Documentos de Apoio

- `crm-utms-e-vendas.md`: venda que fecha no CRM, UTMs, IDs de clique, Meta e Google
- `architecture.md`: por que dual-channel, trade-offs, ordem de deploy
- `datalayer-patterns.md`: catálogo completo de eventos, anti-patterns
- `meta-capi-backend.md`: API CAPI completa: auth, payload, EMQ, Test Events
- `gtm-setup.md`: passo a passo de configuração do container GTM
- `pii-hashing.md`: regras de hashing e normalização, Meta x Google
- `mcp-integrations.md`: APIs do GTM, Meta e GA4 e como ligar no Claude Code
- `validation-testing.md`: Test Events, GTM Preview, checklist de produção

## Scripts

- `scripts/captura-origem.js`: guarda UTMs e IDs de clique no site e preenche o formulário
- `scripts/enviar-venda-crm.ts`: manda a venda do CRM para o Meta (CAPI) e o Google (Data Manager API)
- `scripts/frontend-tracking.ts`: módulo TypeScript completo (React/SPA)
- `scripts/backend-capi.ts`: serviço CAPI Node.js completo
- `scripts/gtm-datalayer-vanilla.js`: exemplos Vanilla JS para qualquer stack
- `scripts/test-capi.sh`: curl para testar CAPI manualmente sem código
- `scripts/debug-datalayer.js`: cola no console do browser para inspecionar pushes
