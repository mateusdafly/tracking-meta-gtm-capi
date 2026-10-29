# Meta Conversions API (CAPI) — Guia Técnico Server-Side

Referência completa para implementação de rastreamento server-side via Meta CAPI em projetos Node.js/Express + TypeScript.

---

## 1. Por que server-side além do pixel browser

O pixel browser (via GTM ou snippet direto) é necessário mas insuficiente. A CAPI não substitui o pixel — os dois canais juntos produzem melhor qualidade de matching e maior cobertura de conversões.

### Problemas do pixel browser isolado

**Ad blockers bloqueiam `connect.facebook.net`**
Ublock Origin, Brave, AdGuard e outros bloqueiam requisições para domínios de rastreamento. Em nichos de alta adoção técnica (desenvolvedores, médicos, profissionais de saúde), a taxa de bloqueio pode ultrapassar 30%. O evento nunca chega à Meta.

**Safari ITP (Intelligent Tracking Prevention)**
O Safari limita cookies de 1st party criados via JavaScript a 7 dias. O cookie `_fbp` (identificador do navegador do pixel) é apagado antes do ciclo de vendas terminar em muitos casos. A Meta perde a capacidade de atribuir a conversão ao anúncio correto.

**Usuário fecha a aba antes da confirmação — crítico para PIX**
O fluxo PIX exige que o usuário abra o app do banco, copie a chave e confirme o pagamento em outro dispositivo ou aba. É comum o usuário fechar a aba do checkout antes de voltar. O evento `Purchase` do pixel (disparado na tela de sucesso) nunca é enviado. O CAPI disparado pelo webhook do gateway (Asaas, Stripe, Mercado Pago etc.) cobre esse caso, independente do comportamento do browser.

**Venda que fecha fora do site**
WhatsApp, telefone, vendedor: não existe página de sucesso. Só a CAPI leva essa venda ao Meta. Ver `crm-utms-e-vendas.md`.

**Navegação SPA perde contexto de página**
Em SPAs (React, Vue, Next.js), a URL muda sem recarga de página. GTM pode perder o contexto de `event_source_url`, a `fbclid` da URL original some do `fbc` após navegação, e o `dataLayer` pode não ser purgado corretamente entre "páginas". O server-side preserva os dados capturados no momento correto.

**Resumo: quando usar cada canal**

| Evento | Pixel browser | CAPI server-side |
|--------|--------------|-----------------|
| PageView | Sim | Não (sem valor) |
| ViewContent | Sim | Opcional |
| InitiateCheckout | Sim | Recomendado |
| AddPaymentInfo | Sim | Recomendado |
| Purchase (cartao) | Sim | Sim (webhook) |
| Purchase (PIX) | Sim (se usuario nao fechar aba) | **Obrigatorio** (webhook) |
| CompleteRegistration | Sim | Sim |

---

## 2. Autenticação

### Tipo de token correto

Para CAPI em produção, use um token que não expira e não depende de uma pessoa:

| Tipo | Duração | Indicado para CAPI |
|------|---------|-------------------|
| User Token | 60 dias | Não: expira |
| Page Token | Variável | Não: escopo errado |
| **Token gerado no Events Manager** | **Não expira** | **Sim, o caminho mais curto** |
| **System User Token** | **Pode ser sem expiração** | **Sim** |

### Como gerar o token

**Pelo Events Manager (mais simples):**
1. Events Manager → selecione o pixel (conjunto de dados)
2. Aba **Configurações** → seção **Conversions API**
3. **Gerar token de acesso**
4. Copie o token: ele só é exibido uma vez

**Por um usuário do sistema (quando várias integrações usam o mesmo Business Manager):**
1. Business Manager → **Configurações do negócio** → **Usuários** → **Usuários do sistema**
2. Crie o usuário do sistema e dê a ele acesso ao pixel
3. **Gerar novo token**, escolha o app e a permissão `ads_management`
4. Copie o token: ele só é exibido uma vez

### Variáveis de ambiente obrigatórias

```bash
META_CAPI_PIXEL_ID=123456789012345
META_CAPI_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxx
META_CAPI_TEST_CODE=          # deixar vazio em producao
META_GRAPH_API_VERSION=v26.0  # opcional
```

**NUNCA commitar o access token.** Adicionar ao `.gitignore`:
```
.env
.env.local
.env.production
```

Verificar se o token já foi exposto:
```bash
git log --all -p | grep -i "EAA"
```

---

## 3. Endpoint da API

```
POST https://graph.facebook.com/v26.0/{PIXEL_ID}/events
```

**Observacoes importantes:**

- Trave a versão da API no código (`v26.0` em outubro de 2026), de preferência numa variável de ambiente. Cada versão vive cerca de 2 anos; confira o calendário em https://developers.facebook.com/docs/graph-api/changelog/versions
- O `access_token` é passado como **query parameter**. Por isso, nunca logue a URL da requisição
- Erros voltam com status HTTP 4xx e um objeto `error` no corpo (ex: `code: 190` = token inválido ou expirado). Trate os dois: status e corpo
- `Content-Type: application/json`
- Método: sempre `POST`
- Até 1.000 eventos por requisição

Exemplo completo da URL montada:
```
https://graph.facebook.com/v26.0/123456789012345/events?access_token=EAAxxxxx
```

---

## 4. Estrutura do payload completo

```json
{
  "data": [
    {
      "event_name": "Purchase",
      "event_time": 1710000000,
      "event_id": "3f6c1a9e-checkout-uuid",
      "action_source": "website",
      "event_source_url": "https://seu-site.com/checkout",
      "user_data": {
        "em": "973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b",
        "ph": "a869177964cc68954ffec997bbad30769f8a5a6fdc60f296ddbc60b9347dc416",
        "fn": "ed2befb11499489e2570cb053f774b8ed93e89eddab3f78867a2a5f32c58845e",
        "ln": "d24e913a4107af875dc2ac3d419798f3794d00434e5059fbb68ac8d33626eaee",
        "external_id": "ca010ec7feb32be7e30002f602d7c2ab062fb7a2be105ae6b8b1fb739cb72c77",
        "fbp": "fb.1.1234567890123.1234567890",
        "fbc": "fb.1.1234567890123.IwAR2xxxxxxxxxxxxxxxxxxx",
        "client_ip_address": "177.100.200.50",
        "client_user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      "custom_data": {
        "value": 197.00,
        "currency": "BRL",
        "content_ids": ["produto-exemplo"],
        "content_type": "product",
        "num_items": 1,
        "order_id": "PAY_12345"
      }
    }
  ],
  "test_event_code": "TEST12345"
}
```

**Observacoes sobre o payload:**

- Os hashes acima são reais: `test@example.com`, `5511999999999`, `joao`, `silva` e `usr_123`, já normalizados
- `data` é sempre um array: permite enviar até 1.000 eventos por requisição
- `event_time` é Unix timestamp em segundos (não milissegundos), e é a hora em que o evento **aconteceu**, não a do envio. No máximo 7 dias atrás: se um evento da requisição for mais velho, a Meta recusa a requisição inteira (venda presencial com `action_source: physical_store` aceita até 62 dias)
- `test_event_code` deve ser **removido** em produção. O evento com código de teste aparece em Test Events **e não é descartado**: entra nos dados do pixel e é usado para segmentação e mensuração

---

## 5. Regras de hashing

A Meta exige que dados PII (Personally Identifiable Information) sejam hasheados com SHA-256 antes de serem enviados pela CAPI. No servidor, o hash é obrigatório. No navegador, o pixel aceita o dado com hash ou sem (sem hash, ele mesmo calcula); se você hashear no navegador, use exatamente a mesma normalização do servidor.

### Campos que DEVEM ser hasheados (SHA-256)

| Campo | Chave na API | Normalizacao antes do hash |
|-------|-------------|--------------------------|
| Email | `em` | trim() + toLowerCase() |
| Telefone | `ph` | só dígitos, com DDI, sem `+` (ex: 5511999999999) |
| Primeiro nome | `fn` | trim() + toLowerCase() |
| Ultimo nome | `ln` | trim() + toLowerCase() |
| Cidade | `ct` | trim() + toLowerCase() |
| Estado/UF | `st` | trim() + toLowerCase() (ex: "sp") |
| CEP | `zp` | apenas digitos |
| Pais | `country` | codigo ISO 2 letras lowercase (ex: "br") |
| Data de nascimento | `db` | formato YYYYMMDD |
| ID externo (interno) | `external_id` | trim() + toLowerCase() |
| Genero | `ge` | "m" ou "f" |

### Campos que NAO devem ser hasheados

| Campo | Chave na API | Motivo |
|-------|-------------|--------|
| Facebook Browser ID | `fbp` | Ja eh identificador opaco |
| Facebook Click ID | `fbc` | Ja eh identificador opaco |
| IP do cliente | `client_ip_address` | Enviado como plain text |
| User Agent | `client_user_agent` | Enviado como plain text |
| Lead ID | `lead_id` | Enviado como plain text |

### Normalizacao de telefone para E.164

```typescript
// Entrada: "11 99999-9999", "(11) 99999-9999", "+55 11 99999-9999", "11999999999"
// Saida esperada para hash: "5511999999999" (sem o +)

function normalizePhone(phone: string): string {
  // Remove tudo exceto digitos e o sinal +
  let normalized = phone.replace(/[^\d+]/g, '')

  // Se ja tem +55, remove o +
  if (normalized.startsWith('+55')) {
    normalized = normalized.slice(1) // remove o +
  }
  // Se comeca com 55 e tem 13 digitos (55 + DDD + 9 digitos)
  else if (normalized.startsWith('55') && normalized.length === 13) {
    // ja esta correto
  }
  // Se comeca com 0, remove o 0 e adiciona 55
  else if (normalized.startsWith('0')) {
    normalized = '55' + normalized.slice(1)
  }
  // Se tem 11 digitos (DDD + numero), adiciona 55
  else if (normalized.length === 11) {
    normalized = '55' + normalized
  }
  // Se tem 10 digitos (DDD + numero sem 9), adiciona 55
  else if (normalized.length === 10) {
    normalized = '55' + normalized
  }

  return normalized
}
```

### Verificacao de hashing correto

Para validar que o hashing está correto, use a [ferramenta de teste da Meta](https://developers.facebook.com/tools/payload_helper/) ou compare com valores conhecidos:

| Entrada já normalizada | SHA-256 |
|---|---|
| `test@example.com` | `973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b` |
| `5511999999999` | `a869177964cc68954ffec997bbad30769f8a5a6fdc60f296ddbc60b9347dc416` |

Confira no terminal: `printf '%s' 'test@example.com' | sha256sum`

---

## 6. Fire-and-forget pattern

O envio para a CAPI nunca deve bloquear a resposta HTTP ao usuário. Um timeout da API da Meta (que pode levar 2-5 segundos) não pode degradar a experiência do checkout.

### Padrao correto no Express

```typescript
// routes/webhooks.ts (ou checkout.ts)
app.post('/api/webhooks/asaas', async (req, res) => {
  const event = req.body

  // 1. Processar o evento no banco PRIMEIRO
  await processPayment(event)

  // 2. Responder ao Asaas imediatamente (ele tem timeout curto)
  res.json({ received: true })

  // 3. Disparar CAPI de forma assíncrona SEM await
  // O erro é capturado mas NAO propaga para o usuario
  sendPurchaseCAPIEvent(event).catch(err => {
    console.error('[CAPI] Falha ao enviar Purchase:', err.message)
    // Considerar: enviar alerta para Discord/Slack em caso de falha
  })
})
```

### Serverless

Em Vercel, Lambda ou Cloud Run com CPU só durante a requisição, o trabalho que continua depois da resposta pode ser cortado e o evento nunca sai. Nesses ambientes, use o `waitUntil` da plataforma ou mande o evento para uma fila.

### Por que nao usar await

```typescript
// ERRADO — bloqueia o retorno ao Asaas
await sendPurchaseCAPIEvent(event)
res.json({ received: true }) // so executa apos CAPI responder (pode demorar 5s)

// CORRETO — nao bloqueia
sendPurchaseCAPIEvent(event).catch(handleError)
res.json({ received: true }) // executa imediatamente
```

### Tratamento de erros sem bloquear

```typescript
async function sendPurchaseCAPIEvent(data: PaymentData): Promise<void> {
  try {
    await sendCAPIEvent({ eventName: 'Purchase', ... })
    console.log('[CAPI] Purchase enviado com sucesso para event_id:', data.capiEventId)
  } catch (err) {
    // Log detalhado para debugging mas sem throw
    console.error('[CAPI] Erro ao enviar Purchase:', {
      error: err instanceof Error ? err.message : String(err),
      eventId: data.capiEventId,
      // NAO logar PII aqui (email, telefone, etc)
    })
    // Opcional: notificar canal de monitoramento
  }
}
```

---

## 7. Persistência do CAPI context no banco

### Por que salvar no momento do checkout (nao no webhook)

O webhook do Asaas chega horas ou dias depois do checkout (especialmente PIX). Nesse momento:
- O `fbp` (cookie do browser) não está mais disponível
- O `fbc` (parâmetro `fbclid` da URL) já sumiu
- O IP do cliente mudou
- O User Agent está ausente

**A janela de captura é o momento em que o usuário preenche o formulário de checkout.** Esses dados devem ser enviados do frontend para o backend e persistidos no banco junto com o pedido.

### Schema mínimo — campos a adicionar ao modelo Payment/Order

```prisma
// schema.prisma
model Payment {
  id          String   @id
  // ... campos existentes ...

  // CAPI tracking context — capturado no momento do checkout
  capiEventId String?  // UUID gerado pelo frontend (para deduplicacao)
  fbp         String?  // cookie _fbp do browser
  fbc         String?  // cookie _fbc ou fbclid da URL
  ipAddress   String?  // IP real do cliente (X-Forwarded-For)
  userAgent   String?  // User-Agent do browser
}
```

### Como capturar no frontend (React/TypeScript)

```typescript
// No componente de checkout, antes de enviar para o backend
function getCapiContext() {
  return {
    capiEventId: checkoutId, // o MESMO ID usado nos pushes do dataLayer
    fbp: getCookie('_fbp') ?? undefined,
    // fbc tem formato próprio: fb.1.{timestamp_ms}.{fbclid}. O fbclid cru NÃO serve.
    fbc: getCookie('_fbc') ?? (getUrlParam('fbclid') ? `fb.1.${Date.now()}.${getUrlParam('fbclid')}` : undefined),
    // ip e userAgent sao capturados pelo backend via req.headers
  }
}

// Enviar junto com os dados do checkout
const response = await fetch('/api/checkout/create', {
  method: 'POST',
  body: JSON.stringify({
    ...checkoutData,
    capiContext: getCapiContext(),
  })
})
```

### Como capturar no backend (Express)

```typescript
// routes/checkout.ts
app.post('/api/checkout/create', async (req, res) => {
  const { capiContext, ...checkoutData } = req.body

  // IP real considerando proxies/Nginx
  const ipAddress = (
    req.headers['x-forwarded-for'] as string
  )?.split(',')[0].trim() ?? req.socket.remoteAddress

  const userAgent = req.headers['user-agent']

  // Salvar no banco junto com o pagamento
  await db.payment.create({
    data: {
      ...processedData,
      capiEventId: capiContext?.capiEventId,
      fbp: capiContext?.fbp,
      fbc: capiContext?.fbc,
      ipAddress,
      userAgent,
    }
  })
})
```

### Como usar no webhook

```typescript
// routes/webhooks.ts — ao processar confirmacao de pagamento
const payment = await db.payment.findUnique({
  where: { asaasPaymentId: event.payment.id }
})

// Recuperar o contexto CAPI salvo no momento do checkout
sendPurchase({
  value: payment.amount,
  currency: 'BRL',
  orderId: payment.id,
  contentIds: [payment.productSlug],
  user: {
    email: payment.customerEmail,
    phone: payment.customerPhone,
    name: payment.customerName,
    externalId: payment.userId,
  },
  capiContext: {
    capiEventId: payment.capiEventId ?? undefined,
    fbp: payment.fbp ?? undefined,
    fbc: payment.fbc ?? undefined,
    ipAddress: payment.ipAddress ?? undefined,
    userAgent: payment.userAgent ?? undefined,
  }
}).catch(err => console.error('[CAPI] Purchase webhook:', err))
```

---

## 8. Deduplicação

### Como funciona

Quando o pixel browser e a CAPI enviam o mesmo evento, a Meta deduplica quando **`event_name` e `event_id` são iguais** e chegam dentro de **48 horas** do primeiro evento com aquele `event_id`. Só o `event_id` igual não basta: o nome do evento também tem que bater.

```
Browser pixel (GTM)   --[event_id: "checkout-abc123-purchase"]--> Meta
                                                                      |
Backend CAPI          --[event_id: "checkout-abc123-purchase"]--> Meta --> DEDUPLICA (conta 1x)
```

### Regras de implementação

**O frontend é a fonte de verdade do event_id.** O backend deve usar exatamente o mesmo ID gerado pelo frontend, recuperado do banco de dados.

```typescript
// CORRETO — usa o event_id original do frontend
sendPurchase({
  eventId: payment.capiEventId, // salvo no banco no checkout
  ...
})

// ERRADO — gera um novo ID no backend (sem deduplicacao)
sendPurchase({
  eventId: crypto.randomUUID(), // NUNCA fazer isso para Purchase
  ...
})
```

### Purchase em 3 canais é intencional

Para pagamento via PIX, podem existir até 3 tentativas de envio do evento Purchase:
1. **Pixel browser** — disparado na tela de sucesso (se o usuário não fechou a aba)
2. **Polling frontend** — disparado quando o frontend detecta pagamento confirmado via polling
3. **Webhook backend** — disparado quando o Asaas notifica a confirmação

Todos os três devem usar o **mesmo `event_id`**. A Meta deduplica automaticamente e conta apenas 1 conversão. Este é o comportamento correto e desejado — não é um bug.

### Evento sem capiEventId no banco

Se o campo `capiEventId` for `null` no banco (checkout antigo, antes da feature), use um ID determinístico como `purchase_{orderId}`. Assim o polling e o webhook geram o mesmo ID e a Meta conta uma venda só. Um UUID novo em cada canal contaria duas.

---

## 9. Test Events

### Para que serve

O painel de Test Events permite verificar em tempo real se os eventos estão chegando corretamente na Meta, com quais dados, e qual o score de qualidade — tudo isso sem afetar os dados de produção do pixel.

### Como acessar

1. Acesse o [Events Manager](https://business.facebook.com/events_manager)
2. Selecione o pixel
3. Aba **Test Events** (ou "Eventos de Teste")
4. Copie o código no campo "Test event code" (ex: `TEST12345`)

### Como usar

```bash
# .env (desenvolvimento)
META_CAPI_TEST_CODE=TEST12345

# .env.production (producao)
META_CAPI_TEST_CODE=   # deixar vazio ou nao definir
```

O serviço CAPI inclui o campo `test_event_code` no payload apenas quando a variável de ambiente está definida e não vazia:

```typescript
const payload: Record<string, unknown> = { data: [eventData] }

const testCode = process.env.META_CAPI_TEST_CODE
if (testCode && testCode.trim() !== '') {
  payload.test_event_code = testCode.trim()
}
```

### Verificando no painel

Após enviar um evento de teste, ele aparece no painel em **tempo real** (latência de 1-2 segundos). O painel mostra:
- Quais campos chegaram (marcados como presentes/ausentes)
- Se o hashing está correto (a Meta valida o formato)
- O Event Match Quality estimado
- Erros de payload (campos inválidos, formato incorreto)

### Remover em producao

Em produção, deixe a variável vazia. O evento com `test_event_code` **não é descartado**: ele aparece em Test Events e também entra nos dados do pixel (segmentação e mensuração). Por isso, faça poucos testes no pixel de produção, ou use um pixel separado para testar.

---

## 10. Event Match Quality (EMQ)

### O que é

O EMQ é um score de 0 a 10 que indica a qualidade do matching entre o evento e um usuário real no Facebook. Quanto maior o score, maior a probabilidade da Meta conseguir atribuir a conversão ao anúncio correto e otimizar o algoritmo de entrega.

**Impacto direto:** EMQ baixo = atribuição de conversão falha = algoritmo de otimização treinado com dados ruins = custo por aquisição mais alto.

### O que aumenta o EMQ

Ordem de importância (da mais para a menos impactante):

| Campo | Impacto no EMQ | Observacao |
|-------|---------------|-----------|
| `fbp` | Alto | Cookie do pixel no browser do usuario |
| `fbc` | Alto | Presente apenas quando ha fbclid na URL (clique de anuncio) |
| `em` (email) | Alto | Campo mais identificador apos fbp/fbc |
| `ph` (telefone) | Medio-alto | Deve estar em E.164 antes do hash |
| `client_ip_address` | Medio | IP real do cliente (sem NAT/proxy) |
| `client_user_agent` | Medio | User-Agent completo |
| `fn` + `ln` | Baixo-medio | Nome completo ajuda no matching |
| `external_id` | Baixo | ID interno hasheado |
| `ct` + `st` + `country` | Baixo | Cidade + estado + pais |

### O que diminui o EMQ

- **Campos ausentes:** Cada campo faltante reduz o score
- **Hashing incorreto:** Email não normalizado antes do hash resulta em mismatch (maiúsculas, espaços)
- **Telefone sem DDI:** `11999999999` em vez de `5511999999999` — hash diferente do que a Meta tem na base
- **IP do servidor:** Enviar o IP interno do servidor (127.0.0.1, 10.x.x.x) em vez do IP real do cliente
- **User-Agent ausente ou incorreto:** String vazia ou user-agent do servidor

### Targets de EMQ por tipo de evento

| Evento | EMQ aceitável | EMQ bom | EMQ excelente |
|--------|--------------|---------|--------------|
| Purchase | >= 6.0 | >= 7.5 | >= 8.5 |
| Lead | >= 5.0 | >= 7.0 | >= 8.0 |
| ViewContent | >= 4.0 | >= 6.0 | >= 7.5 |

### Verificando o EMQ

1. Events Manager → selecionar o pixel
2. Aba **Overview** → seção "Event Match Quality"
3. Clicar no evento para ver breakdown por campo

Para eventos individuais durante desenvolvimento, usar o painel de Test Events que mostra o EMQ estimado para cada evento enviado.

---

## 11. Venda confirmada depois: event_time e action_source

**`event_time` é quando a venda aconteceu.** Webhook que chega minutos depois, venda marcada no CRM dias depois: mande a hora real, não a hora do envio.

**Limite de 7 dias.** A Meta aceita `event_time` de até 7 dias atrás. Se um evento da requisição for mais velho, ela recusa a requisição inteira e nenhum evento é processado. O `scripts/backend-capi.ts` falha antes de mandar, com mensagem clara. Venda presencial (`physical_store`) aceita até 62 dias.

**`action_source` diz onde a conversão aconteceu:**

| Valor | Quando usar |
|---|---|
| `website` | conversão no site (exige `client_user_agent`) |
| `chat` | WhatsApp, direct, chat |
| `phone_call` | telefone |
| `physical_store` | presencial, na loja ou no consultório |
| `email` | por email |
| `system_generated` | automática, ex: renovação de assinatura |
| `business_messaging` | anúncio de clique para Messenger, Instagram ou WhatsApp |
| `app` | app móvel |
| `other` | nenhum dos anteriores |

Todos os valores servem para mensuração, públicos e otimização. Para a venda que fecha no CRM, o fluxo completo (UTMs, IDs de clique, Google) está em `crm-utms-e-vendas.md`.
