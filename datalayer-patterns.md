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
| `ViewContent` | `view_item` | Usuário vê página/modal do produto |
| `CompleteRegistration` | `sign_up` | Cadastro ou login bem-sucedido |
| `InitiateCheckout` | `begin_checkout` | Abre o fluxo de checkout |
| `AddPaymentInfo` | `add_payment_info` | Preenche dados de pagamento |
| `Purchase` | `purchase` | Pagamento confirmado |

### ViewContent

```js
// Meta push
window.dataLayer.push({
  event: 'ViewContent',
  content_ids: ['kit-completo'],
  content_type: 'product',
  value: 47.90,
  currency: 'BRL',
  content_name: 'Kit FlyVet - Acesso Vitalício',
  event_id: crypto.randomUUID(), // para deduplicação com CAPI
})

// GA4 push (separado!)
window.dataLayer.push({ ecommerce: null })
window.dataLayer.push({
  event: 'view_item',
  ecommerce: {
    currency: 'BRL',
    value: 47.90,
    items: [{
      item_id: 'kit-completo',
      item_name: 'Kit FlyVet - Acesso Vitalício',
      price: 47.90,
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
  content_ids: ['kit-completo'],
  content_type: 'product',
  value: 47.90,
  currency: 'BRL',
  num_items: 1,
  event_id: crypto.randomUUID(),
})

// GA4 push (separado!)
window.dataLayer.push({ ecommerce: null })
window.dataLayer.push({
  event: 'begin_checkout',
  ecommerce: {
    currency: 'BRL',
    value: 47.90,
    items: [{
      item_id: 'kit-completo',
      item_name: 'Kit FlyVet - Acesso Vitalício',
      price: 47.90,
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
  content_ids: ['kit-completo'],
  content_type: 'product',
  value: 47.90,
  currency: 'BRL',
  payment_method: 'PIX', // ou 'credit_card'
  event_id: crypto.randomUUID(),
})

// GA4 push (separado!)
window.dataLayer.push({ ecommerce: null })
window.dataLayer.push({
  event: 'add_payment_info',
  ecommerce: {
    currency: 'BRL',
    value: 47.90,
    payment_type: 'PIX',
    items: [{
      item_id: 'kit-completo',
      item_name: 'Kit FlyVet - Acesso Vitalício',
      price: 47.90,
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
  content_ids: ['kit-completo'],
  content_type: 'product',
  value: 47.90,
  currency: 'BRL',
  num_items: 1,
  transaction_id: 'PAY_123abc',
  payment_method: 'PIX',
  event_id: 'uuid-gerado-no-frontend-e-enviado-ao-backend', // CRÍTICO
})

// GA4 push (separado!)
window.dataLayer.push({ ecommerce: null })
window.dataLayer.push({
  event: 'purchase',
  ecommerce: {
    transaction_id: 'PAY_123abc',
    value: 47.90,
    currency: 'BRL',
    payment_type: 'PIX',
    items: [{
      item_id: 'kit-completo',
      item_name: 'Kit FlyVet - Acesso Vitalício',
      price: 47.90,
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
    value: 47.90,
    currency: 'BRL',
    payment_type: 'PIX',       // dimensão customizada
    items: [{
      item_id: 'kit-completo',
      item_name: 'Kit Premium',
      price: 47.90,
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
  content_ids: ['kit-completo'],  // array de IDs
  content_type: 'product',        // 'product' ou 'product_group'
  value: 47.90,
  currency: 'BRL',
  num_items: 1,
  transaction_id: 'PAY_123',
  payment_method: 'PIX',          // dimensão customizada
  event_id: 'uuid-gerado-no-frontend', // CRÍTICO para CAPI dedup

  // Dados do usuário hasheados (SHA-256, lowercase, sem espaços)
  user: {
    email: 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
    fn: 'hash-sha256-do-primeiro-nome',
    ln: 'hash-sha256-do-sobrenome',
    phone: 'hash-sha256-do-telefone-em-e164', // ex: +5511999999999
    external_id: 'uuid-raw-do-usuario',       // NÃO hasheado
  }
})
```

**Sobre o objeto `user`:**
O GTM tem uma tag do Meta Pixel que pode ser configurada para ler variáveis de dataLayer e enviá-las como Advanced Matching. Definir `user` no push permite que a tag passe esses dados automaticamente para o fbq sem que você precise chamar `fbq` diretamente.

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
  value: 47.90,             // ambos leem, mas de lugares diferentes
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

Todos os PII (Personally Identifiable Information) devem ser hasheados com SHA-256 antes de entrar no dataLayer. A Meta exige: lowercase, sem espaços extras, formato E.164 para telefone.

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
  const [hashedEmail, hashedFn, hashedLn, hashedPhone] = await Promise.all([
    sha256(email),
    sha256(firstName),
    sha256(lastName),
    sha256(phone), // já em E.164: +5511999999999
  ])

  window.dataLayer.push({
    user: {
      email: hashedEmail,
      fn: hashedFn,
      ln: hashedLn,
      phone: hashedPhone,
      external_id: userId, // UUID raw, não hasheado
    }
  })
}
```

### Quando chamar `setUserInDataLayer`

- Logo após login/cadastro (antes do `CompleteRegistration`)
- Ao abrir o checkout (antes do `InitiateCheckout`)
- Quando o usuário já estava logado ao entrar na página (na montagem do componente/contexto de auth)

Como o dataLayer persiste estado, uma vez setado, o objeto `user` estará disponível em todos os pushes subsequentes. As tags do GTM vão conseguir ler esses dados em qualquer evento.

### Formato E.164 para telefone

```
+5511999999999  (Brasil, celular SP)
+5521999999999  (Brasil, celular RJ)
+14155552671    (EUA)
```

Sempre remover: espaços, traços, parênteses, pontos. Sempre incluir DDI.

---

## 7. Erros comuns

### Esquecer `{ ecommerce: null }` antes de eventos GA4

```js
// Push 1
window.dataLayer.push({
  event: 'begin_checkout',
  ecommerce: { value: 47.90, items: [{ item_id: 'kit-completo' }] }
})

// Push 2 — SEM limpar ecommerce primeiro
window.dataLayer.push({
  event: 'purchase',
  ecommerce: { value: 47.90, transaction_id: 'PAY_123', items: [{ item_id: 'kit-completo' }] }
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

**Correção:** gerar um UUID no frontend, colocar no push do dataLayer, E enviar esse mesmo UUID para o backend junto com os dados de pagamento. O backend inclui no request da CAPI.

```js
const eventId = crypto.randomUUID() // gera no frontend

// Envia para dataLayer (Pixel vai usar)
window.dataLayer.push({
  event: 'Purchase',
  event_id: eventId,
  // ...
})

// Envia para o backend (CAPI vai usar)
await fetch('/api/checkout/confirm', {
  method: 'POST',
  body: JSON.stringify({ paymentId, eventId, /* ... */ })
})
```

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
  value: 47.90,      // Meta lê aqui
  ecommerce: {
    value: 47.90,    // GA4 lê aqui
    // ...
  }
})
```

Tecnicamente isso funciona para os valores básicos, mas:
- O nome do evento `Purchase` (PascalCase) vai aparecer assim no GA4 DebugView e nos relatórios de eventos customizados
- É impossível usar variáveis de dataLayer distintas para cada plataforma quando há conflito de nomes
- Debugging vira pesadelo: qual tag está lendo qual campo?

**Correção:** dois pushes. Clareza sempre supera brevidade.
