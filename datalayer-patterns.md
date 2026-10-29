# Data Layer Patterns — GTM + Meta Pixel + GA4

Guia completo de padrões para Data Layer em projetos com Google Tag Manager, Meta Pixel e GA4.

---

## 1. O que é o dataLayer

`window.dataLayer` é um array global criado pelo Google Tag Manager. Ele funciona como uma **fila de mensagens** entre o código da aplicação e as tags do GTM.

```js
// GTM injeta esse snippet antes de qualquer outro script
window.dataLayer = window.dataLayer || [];
```

### Como o GTM consome o dataLayer

Quando você faz `window.dataLayer.push({ event: 'Purchase', ... })`, o GTM:

1. Intercepta o push via um listener interno (sobrescreve `Array.prototype.push` no contexto do array)
2. Mescla os dados no **estado atual** do dataLayer (chaves persistem entre pushes!)
3. Dispara todas as tags configuradas para aquele `event`
4. Passa as variáveis disponíveis para cada tag

### Por que usar dataLayer em vez de chamar fbq/gtag diretamente

| Abordagem | Problema |
|-----------|----------|
| `fbq('track', 'Purchase', ...)` direto | Acopla código ao Pixel ID; exige redeploy para mudar config |
| `gtag('event', 'purchase', ...)` direto | Mesmo problema com GA4; duplica código |
| `dataLayer.push(...)` | Tag Manager centraliza; sem redeploy para mudanças de tags |

O dataLayer é o **contrato entre dev e marketing**. O dev define o que envia; o marketing configura o que fazer com isso no GTM — sem tocar no código.

**Atenção ao estado persistente:** o dataLayer acumula estado. Uma chave empurrada num push anterior continua disponível no próximo evento, a menos que seja explicitamente sobrescrita ou limpa. Por isso o padrão `{ ecommerce: null }` existe.

---

## 2. Catálogo de eventos do funil

### Tabela resumo

| Evento (Meta/PascalCase) | Evento GA4 (snake_case) | Gatilho |
|--------------------------|-------------------------|---------|
| `Lead` | `generate_lead` | Formulário de contato enviado (backend respondeu com o ID do lead) |
| `ViewContent` | `view_item` | Usuário vê página/modal do produto |
| `CompleteRegistration` | `sign_up` | Cadastro ou login bem-sucedido |
| `InitiateCheckout` | `begin_checkout` | Abre o fluxo de checkout |
| `AddPaymentInfo` | `add_payment_info` | Preenche dados de pagamento |
| `Purchase` | `purchase` | Pagamento confirmado |

### Lead

```js
// Depois que o backend respondeu { leadId } ao POST do formulário
// Meta push: o backend manda a CAPI com o mesmo ID (sendLead)
window.dataLayer.push({
  event: 'Lead',
  event_id: 'lead_' + leadId,
})

// GA4 push
window.dataLayer.push({ event: 'generate_lead' })
```

Os campos ocultos de origem (UTMs, `fbc`, `gclid`) vão no próprio formulário: ver `crm-utms-e-vendas.md`.

### ViewContent

```js
// Meta push
window.dataLayer.push({
  event: 'ViewContent',
  content_ids: ['produto-exemplo'],
  content_type: 'product',
  value: 197.00,
  currency: 'BRL',
  content_name: 'Produto Exemplo',
  event_id: crypto.randomUUID(), // para deduplicação com CAPI
})

// GA4 push (separado!)
window.dataLayer.push({ ecommerce: null })
window.dataLayer.push({
  event: 'view_item',
  ecommerce: {
    currency: 'BRL',
    value: 197.00,
    items: [{
      item_id: 'produto-exemplo',
      item_name: 'Produto Exemplo',
      price: 197.00,
      quantity: 1,
      item_category: 'digital',
    }]
  }
})
```

### CompleteRegistration

```js
// Meta push
window.dataLayer.push({
  event: 'CompleteRegistration',
  content_name: 'login',   // ou 'signup'
  status: true,
  event_id: crypto.randomUUID(),
})

// GA4 push (separado!)
window.dataLayer.push({
  event: 'sign_up',
  method: 'magic_code', // ou 'magic_link', 'google', etc.
})
```

### InitiateCheckout

```js
// Meta push
window.dataLayer.push({
  event: 'InitiateCheckout',
  content_ids: ['produto-exemplo'],
  content_type: 'product',
  value: 197.00,
  currency: 'BRL',
  num_items: 1,
  event_id: checkoutId, // gerado UMA vez quando o checkout abriu e enviado ao backend
})

// GA4 push (separado!)
window.dataLayer.push({ ecommerce: null })
window.dataLayer.push({
  event: 'begin_checkout',
  ecommerce: {
    currency: 'BRL',
    value: 197.00,
    items: [{
      item_id: 'produto-exemplo',
      item_name: 'Produto Exemplo',
      price: 197.00,
      quantity: 1,
      item_category: 'digital',
    }]
  }
})
```

### AddPaymentInfo

```js
// Meta push
window.dataLayer.push({
  event: 'AddPaymentInfo',
  content_ids: ['produto-exemplo'],
  content_type: 'product',
  value: 197.00,
  currency: 'BRL',
  payment_method: 'PIX', // ou 'credit_card'
  event_id: checkoutId, // o mesmo do InitiateCheckout
})

// GA4 push (separado!)
window.dataLayer.push({ ecommerce: null })
window.dataLayer.push({
  event: 'add_payment_info',
  ecommerce: {
    currency: 'BRL',
    value: 197.00,
    payment_type: 'PIX',
    items: [{
      item_id: 'produto-exemplo',
      item_name: 'Produto Exemplo',
      price: 197.00,
      quantity: 1,
      item_category: 'digital',
    }]
  }
})
```

### Purchase

```js
// Meta push
window.dataLayer.push({
  event: 'Purchase',
  content_ids: ['produto-exemplo'],
  content_type: 'product',
  value: 197.00,
  currency: 'BRL',
  num_items: 1,
  transaction_id: 'PAY_123abc',
  payment_method: 'PIX',
  event_id: checkoutId, // CRÍTICO: o mesmo que o backend salvou e usa no webhook
})

// GA4 push (separado!)
window.dataLayer.push({ ecommerce: null })
window.dataLayer.push({
  event: 'purchase',
  ecommerce: {
    transaction_id: 'PAY_123abc',
    value: 197.00,
    currency: 'BRL',
    payment_type: 'PIX',
    items: [{
      item_id: 'produto-exemplo',
      item_name: 'Produto Exemplo',
      price: 197.00,
      quantity: 1,
      item_category: 'digital',
    }]
  }
})
```

---

## 3. Estrutura de push para GA4 (dentro de `ecommerce`)

GA4 exige o padrão Enhanced Ecommerce com o objeto `ecommerce` aninhado:

```js
// SEMPRE limpar o objeto ecommerce anterior antes de um novo evento
window.dataLayer.push({ ecommerce: null })

window.dataLayer.push({
  event: 'purchase',           // snake_case para GA4
  ecommerce: {
    transaction_id: 'PAY_123', // obrigatório para deduplicação
    value: 197.00,
    currency: 'BRL',
    payment_type: 'PIX',       // dimensão customizada
    items: [{
      item_id: 'produto-exemplo',
      item_name: 'Produto Exemplo',
      price: 197.00,
      quantity: 1,
      item_category: 'digital',
    }]
  }
})
```

**Campos obrigatórios para GA4 Enhanced Ecommerce:**
- `transaction_id` (purchase) — sem ele, GA4 pode deduplicar incorretamente
- `value` + `currency` — necessários para relatórios de receita
- `items[]` — pelo menos `item_id` ou `item_name`

---

## 4. Estrutura de push para Meta Pixel (fora de `ecommerce`)

Meta Pixel usa campos no nível raiz do push, fora de qualquer objeto aninhado:

```js
window.dataLayer.push({
  event: 'Purchase',              // PascalCase para Meta
  content_ids: ['produto-exemplo'],  // array de IDs
  content_type: 'product',        // 'product' ou 'product_group'
  value: 197.00,
  currency: 'BRL',
  num_items: 1,
  transaction_id: 'PAY_123',
  payment_method: 'PIX',          // dimensão customizada
  event_id: checkoutId, // CRÍTICO para CAPI dedup

  // Dados do usuário hasheados (SHA-256, lowercase, sem espaços)
  user: {
    email: '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b', // test@example.com
    fn: 'hash-sha256-do-primeiro-nome',
    ln: 'hash-sha256-do-sobrenome',
    phone: 'hash-sha256-do-telefone',  // de 5511999999999: só dígitos, com DDI, SEM "+"
    external_id: 'hash-sha256-do-id',  // com hash, igual ao que o backend manda na CAPI
  }
})
```

**Sobre o objeto `user`:**
Ele só vira Advanced Matching se uma tag passar esses valores para o pixel. Pushar `user` no dataLayer, sozinho, não manda nada. Ver a tag "Meta - Advanced Matching" em `gtm-setup.md`, que dispara no evento `user_identified`.

---

## 5. Por que dois pushes separados para o mesmo evento

GA4 e Meta Pixel têm **estruturas de dados incompatíveis**:

| Aspecto | GA4 | Meta Pixel |
|---------|-----|------------|
| Casing do evento | `snake_case` (`purchase`) | `PascalCase` (`Purchase`) |
| Dados do item | Dentro de `ecommerce.items[]` | Dentro de `content_ids[]` (só IDs) |
| Valor | `ecommerce.value` | `value` (raiz) |
| Deduplicação | `transaction_id` em `ecommerce` | `event_id` na raiz |
| Advanced Matching | N/A | `user.*` hasheado |

Se você tentar um único push para servir os dois:

```js
// ERRADO — não faça isso
window.dataLayer.push({
  event: 'Purchase',        // casing errado para GA4
  ecommerce: { ... },       // GA4 vai ler isso
  content_ids: [...],       // Meta vai ler isso
  value: 197.00,             // ambos leem, mas de lugares diferentes
  event_id: 'uuid',         // GA4 ignora, Meta usa
})
```

O GTM vai disparar a tag do GA4 e a tag do Meta Pixel para o mesmo push. A tag do GA4 vai procurar `event` no formato correto e `ecommerce.*`. A tag do Meta vai procurar `content_ids`, `value` na raiz, etc. **Eles conseguem coexistir num push, mas:**

1. O nome do evento (`Purchase` vs `purchase`) vai causar discrepâncias nos relatórios do GA4 se você usar o nome do evento como dimensão
2. A estrutura `ecommerce` do GA4 e os campos raiz do Meta têm sobreposições que podem confundir durante debugging
3. Qualquer campo em conflito (ex: `value` dentro de `ecommerce` vs na raiz) vai se comportar diferente em cada tag

**Solução:** dois pushes independentes, cada um formatado para seu destino.

---

## 6. Objeto `user` — dados do usuário

### Estrutura e hashing

Todos os PII (Personally Identifiable Information) devem ser hasheados com SHA-256 antes de entrar no dataLayer. A normalização tem que ser a mesma do backend: email em minúsculas e sem espaços, telefone só com dígitos, com DDI e sem "+".

```js
async function sha256(str) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(str.toLowerCase().trim())
  )
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// Chamada setUserInDataLayer antes de qualquer evento de checkout
async function setUserInDataLayer({ email, firstName, lastName, phone, userId }) {
  const [hashedEmail, hashedFn, hashedLn, hashedPhone, hashedUserId] = await Promise.all([
    sha256(email),
    sha256(firstName),
    sha256(lastName),
    sha256(phone), // já normalizado: 5511999999999 (sem "+")
    sha256(String(userId)),
  ])

  window.dataLayer.push({
    event: 'user_identified', // dispara a tag de Advanced Matching
    user: {
      email: hashedEmail,
      fn: hashedFn,
      ln: hashedLn,
      phone: hashedPhone,
      external_id: hashedUserId, // com hash, igual ao backend
    }
  })
}
```

### Quando chamar `setUserInDataLayer`

- Logo após login/cadastro (antes do `CompleteRegistration`)
- Ao abrir o checkout (antes do `InitiateCheckout`)
- Quando o usuário já estava logado ao entrar na página (na montagem do componente/contexto de auth)

Como o dataLayer persiste estado, uma vez setado, o objeto `user` estará disponível em todos os pushes subsequentes. As tags do GTM vão conseguir ler esses dados em qualquer evento.

### Formato do telefone antes do hash

| Plataforma | Formato | Exemplo |
|---|---|---|
| Meta (pixel e CAPI) | só dígitos, com DDI, sem "+" | `5511999999999` |
| Google (Data Manager API) | E.164 com "+" | `+5511999999999` |

O "+" muda o hash. Sempre remover espaços, traços, parênteses e pontos, e sempre incluir o DDI. Ver `pii-hashing.md`.

---

## 7. Erros comuns

### Esquecer `{ ecommerce: null }` antes de eventos GA4

```js
// Push 1
window.dataLayer.push({
  event: 'begin_checkout',
  ecommerce: { value: 197.00, items: [{ item_id: 'produto-exemplo' }] }
})

// Push 2 — SEM limpar ecommerce primeiro
window.dataLayer.push({
  event: 'purchase',
  ecommerce: { value: 197.00, transaction_id: 'PAY_123', items: [{ item_id: 'produto-exemplo' }] }
})
```

O GA4 vai receber o evento `purchase` com os dados de `ecommerce` do push atual MAIS resíduos do push anterior. Isso causa dados duplicados em relatórios de GA4.

**Correção:** sempre `window.dataLayer.push({ ecommerce: null })` imediatamente antes de qualquer push com objeto `ecommerce`.

---

### `event_id` faltando — Meta não consegue deduplica com CAPI

O Meta Conversion API (CAPI) server-side e o Pixel browser-side vão disparar para o mesmo evento de Purchase. A Meta usa `event_id` para entender que são o mesmo evento e deduplica (conta apenas uma conversão).

Sem `event_id`:
- Pixel dispara `Purchase` com seus dados
- CAPI dispara `Purchase` com seus dados
- Meta conta **duas conversões** para a mesma compra
- Seus relatórios de ROAS ficam inflados

**Correção:** gerar UM ID quando o checkout abre, mandar ao backend no POST que cria o pagamento (o backend salva no banco) e usar esse mesmo ID em todos os pushes do checkout. O webhook do backend lê o ID do banco e manda na CAPI.

```js
// Checkout abriu
const checkoutId = crypto.randomUUID()

// Backend salva checkoutId junto com o pagamento (capiEventId)
await fetch('/api/checkout/create', {
  method: 'POST',
  body: JSON.stringify({ checkoutId, /* produto, contato... */ })
})

// Pagamento confirmado (polling): o pixel usa o MESMO ID
window.dataLayer.push({
  event: 'Purchase',
  event_id: checkoutId,
  // ...
})
```

**Erro que parece certo:** gerar `crypto.randomUUID()` na hora do Purchase e mandar ao backend depois. O webhook pode chegar antes, já com o ID salvo no checkout, e aí o navegador e o webhook mandam IDs diferentes. A Meta conta duas vendas.

---

### Pushar PII não hasheado

```js
// ERRADO — viola políticas Meta e Google
window.dataLayer.push({
  user: {
    email: 'joao@exemplo.com.br',  // PII raw!
    phone: '11999999999',           // PII raw!
  }
})
```

O GTM Data Layer é visível em ferramentas de debug (Tag Assistant, console do browser). Se um PII vaza sem hash, qualquer extensão de browser ou script de terceiro pode capturá-lo.

**Correção:** sempre SHA-256 antes de pushar. Hashear no cliente (Web Crypto API) antes de qualquer push.

---

### GA4 e Meta no mesmo push — conflito de estrutura

Detalhe sutil: a tag do Meta Pixel no GTM lê `value` da raiz do push. A tag do GA4 Enhanced Ecommerce lê `ecommerce.value`. Se você pushar ambos juntos:

```js
window.dataLayer.push({
  event: 'Purchase', // casing errado para GA4
  value: 197.00,      // Meta lê aqui
  ecommerce: {
    value: 197.00,    // GA4 lê aqui
    // ...
  }
})
```

Tecnicamente isso funciona para os valores básicos, mas:
- O nome do evento `Purchase` (PascalCase) vai aparecer assim no GA4 DebugView e nos relatórios de eventos customizados
- É impossível usar variáveis de dataLayer distintas para cada plataforma quando há conflito de nomes
- Debugging vira pesadelo: qual tag está lendo qual campo?

**Correção:** dois pushes. Clareza sempre supera brevidade.
