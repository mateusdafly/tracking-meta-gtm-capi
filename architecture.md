# Arquitetura: Rastreamento Dual-Channel

Este documento explica as decisões de design do sistema de rastreamento e o fluxo completo desde o clique do usuário até o Meta Events Manager. Destina-se a desenvolvedores implementando o sistema do zero.

---

## Por que Dual-Channel?

### O problema dos rastreadores browser-only

Um pixel de browser (fbq, gtag) depende inteiramente do ambiente do cliente para funcionar. Esse ambiente é cada vez mais hostil ao rastreamento:

**Ad blockers:** uBlock Origin, AdBlock Plus e equivalentes bloqueiam requisições ao `connect.facebook.net` antes mesmo do script carregar. Em audiências técnicas (desenvolvedores, SaaS B2B), a taxa de bloqueio pode passar de 40%.

**Safari ITP (Intelligent Tracking Prevention):** desde o Safari 14, cookies de terceiros são bloqueados por padrão. O `_fbp` e o `_fbc` — que a Meta usa para identificar o usuário no browser — têm vida útil limitada a 7 dias em primeiro clique e são apagados completamente em alguns contextos de iOS 17+. Isso degrada o matching mesmo quando o pixel carrega corretamente.

**Usuário fecha a aba:** em checkouts PIX, o fluxo típico é: usuário paga no app do banco, volta ao site, e só então o frontend dispara o evento Purchase. Se ele não voltou — fechou a aba depois de pagar no banco — o evento browser nunca dispara.

**SPA hydration race conditions:** em React, o componente de sucesso pode montar antes do GTM carregar completamente, resultando em `fbq is not defined`. Isso não acontece em toda visita, mas em condições de rede lenta é reproduzível.

### Por que CAPI não substitui o pixel

A Conversions API server-side resolve todos os problemas acima: o servidor sempre envia o evento, independente do que acontece no browser. Mas CAPI tem suas próprias limitações:

**Sem dados de sessão:** o servidor não tem acesso ao contexto de navegação do usuário — URL da página, referrer, scroll depth. Esse contexto existe apenas no browser.

**Qualidade de matching degradada sem fbp/fbc:** o `_fbp` é um identificador único gerado pelo pixel da Meta no browser do usuário. Sem ele, a Meta precisa fazer matching apenas por email/telefone/IP, o que é menos preciso. Mais conversões ficam sem atribuição.

**Attribution window diferente:** eventos CAPI puros têm janelas de atribuição menores por padrão no Meta Ads Manager.

**Conclusão:** os dois canais são complementares, não substitutos. A estratégia correta é enviar SEMPRE pelos dois, e usar o `event_id` para que a Meta elimine duplicatas automaticamente.

---

## O event_id como Fonte de Verdade

### Por que o frontend é quem gera

O `event_id` precisa existir no momento em que o browser dispara o pixel. Isso significa que ele deve ser gerado antes da chamada ao backend, não depois.

O fluxo correto é:

1. Usuário clica em "Pagar"
2. Frontend gera `eventId = crypto.randomUUID()` — uma vez, e armazena em estado React
3. Frontend faz `dataLayer.push({ event: 'InitiateCheckout', event_id: eventId, ... })`
4. GTM capta o push e chama `fbq('track', 'InitiateCheckout', {...}, { eventID: eventId })`
5. Frontend inclui `eventId` no body do POST para o backend
6. Backend recebe, salva no banco junto com o pagamento, e dispara CAPI com o mesmo `eventId`

Se o backend gerasse o `event_id`, seria necessário aguardar a resposta da API antes de disparar o pixel — adicionando latência perceptível ao usuário e criando um ponto de falha.

### Por que salvar no banco

O `event_id` precisa sobreviver ao ciclo de vida da requisição HTTP. Dois cenários exigem isso:

**Polling de status:** em checkouts PIX, o frontend faz polling a cada 3 segundos perguntando se o pagamento foi confirmado. Quando confirmado, o backend precisa do `event_id` original para enviar CAPI Purchase com o identificador correto. Se não estiver no banco, seria necessário gerá-lo novamente — quebrando a deduplicação.

**Webhook de gateway:** o Asaas (ou qualquer outro gateway) envia um webhook minutos depois da confirmação. Nesse momento, a requisição original já terminou há muito tempo. O único jeito de ter o `event_id` original é tê-lo persistido.

### Schema Prisma (exemplo)

```prisma
model Payment {
  id           String    @id @default(cuid())
  // ... outros campos
  capiEventId  String?   // UUID gerado pelo frontend
  fbp          String?   // Cookie _fbp (NÃO hashear)
  fbc          String?   // Cookie _fbc (NÃO hashear)
  ipAddress    String?   // IP do cliente no momento do checkout
  userAgent    String?   // User-Agent do navegador
}
```

`fbp` e `fbc` também precisam ser persistidos porque o webhook não tem acesso ao browser do usuário — os cookies precisam vir do momento original do checkout.

---

## Diagrama de Fluxo Completo

```
USUÁRIO                    FRONTEND (React)            BACKEND (Express)         META
   │                              │                           │                    │
   │ clica "Comprar"              │                           │                    │
   │─────────────────────────────>│                           │                    │
   │                              │                           │                    │
   │                              │ gera eventId (UUID)       │                    │
   │                              │ lê _fbp, _fbc do cookie   │                    │
   │                              │                           │                    │
   │                              │ dataLayer.push({          │                    │
   │                              │   event: 'InitiateCheckout'                    │
   │                              │   event_id: eventId       │                    │
   │                              │ })                        │                    │
   │                              │──────────────────────────────────────────────>│
   │                              │              GTM capta push → fbq('track',    │
   │                              │              'InitiateCheckout', {}, {eventID})│
   │                              │                           │                    │
   │                              │ POST /checkout {          │                    │
   │                              │   eventId, fbp, fbc,      │                    │
   │                              │   email, produto, ...     │                    │
   │                              │ }                         │                    │
   │                              │──────────────────────────>│                    │
   │                              │                           │ salva no banco:    │
   │                              │                           │   capiEventId      │
   │                              │                           │   fbp, fbc         │
   │                              │                           │   ipAddress        │
   │                              │                           │   userAgent        │
   │                              │                           │                    │
   │                              │                           │ CAPI InitiateCheckout
   │                              │                           │──────────────────>│
   │                              │                           │  event_id: eventId │
   │                              │                           │  (fire-and-forget) │
   │                              │                           │                    │
   │                              │◄── { paymentId, pixCode } │                    │
   │                              │                           │                    │
   │ usuário paga no app do banco  │                           │                    │
   │                              │                           │                    │
   │                    [CAMINHO A: usuário permanece no site] │                    │
   │                              │                           │                    │
   │                              │ polling GET /status/paymentId                  │
   │                              │──────────────────────────>│                    │
   │                              │◄── { status: 'CONFIRMED' }│                    │
   │                              │                           │                    │
   │                              │ dataLayer.push({          │ CAPI Purchase      │
   │                              │   event: 'Purchase',      │──────────────────>│
   │                              │   event_id: eventId       │  event_id: eventId │
   │                              │ })                        │  (mesmo UUID)      │
   │                              │──────────────────────────────────────────────>│
   │                              │       GTM → fbq('track','Purchase',{},{eventID})
   │                              │                           │                    │
   │                    [CAMINHO B: usuário fechou a aba]      │                    │
   │                              │                           │                    │
   │                              │               Asaas envia webhook              │
   │                              │               POST /webhooks/asaas             │
   │                              │                           │                    │
   │                              │                 busca Payment no banco         │
   │                              │                 recupera capiEventId, fbp, fbc │
   │                              │                           │                    │
   │                              │                           │ CAPI Purchase      │
   │                              │                           │──────────────────>│
   │                              │                           │  event_id: eventId │
   │                              │                           │  (mesmo UUID de A) │
   │                              │                           │                    │
   │                              │                    Meta deduplica: mesmo       │
   │                              │                    event_id = 1 conversão      │
```

### O que acontece na Meta ao receber

A Meta mantém uma janela de deduplicação de **48 horas** por `event_id`. Se o mesmo `event_id` chegar por múltiplos canais (pixel browser + CAPI polling + CAPI webhook), apenas **uma** conversão é registrada. Isso é o comportamento correto.

Se os `event_id` fossem diferentes por canal, a Meta contaria 2 ou 3 conversões para uma única venda.

---

## Ordem de Deploy

A ordem importa porque cada camada depende da anterior funcionar corretamente.

### 1. Schema migration (banco de dados)

Antes de qualquer código novo, adicionar os campos `capiEventId`, `fbp`, `fbc`, `ipAddress`, `userAgent` ao modelo Payment (ou equivalente).

**Por que primeiro:** se o backend tentar salvar esses campos antes da migration rodar, o Prisma vai lançar erro. A migration é não-destrutiva (adiciona colunas `nullable`), então pode rodar em produção sem downtime.

```bash
npx prisma migrate deploy
```

### 2. Backend

Com o schema atualizado, fazer deploy do backend com:
- Recebimento e persistência dos campos CAPI no checkout
- Serviço CAPI com fire-and-forget
- Webhook atualizado para recuperar e usar o `event_id` do banco

**Por que segundo:** o frontend vai começar a enviar `eventId`, `fbp`, `fbc` no body do POST. Se o backend antigo receber esses campos, simplesmente os ignorará (sem erros). Mas se o frontend novo chegar primeiro e o backend não persistir os campos, todos os checkouts desse período perdem a deduplicação CAPI.

**Validar antes de ir para frente:** usar `META_CAPI_TEST_CODE` para confirmar que os eventos chegam no Meta Events Manager com `event_id` correto.

```bash
META_CAPI_TEST_CODE=TESTxxxxxxxx npm start
# Fazer um checkout de teste e verificar no Events Manager → Test Events
```

### 3. Frontend

Com o backend pronto para receber, fazer deploy do frontend com:
- Geração do `eventId` no início do checkout
- Leitura dos cookies `_fbp` e `_fbc`
- Inclusão de `event_id` em todos os `dataLayer.push()`
- Envio de `eventId`, `fbp`, `fbc` no body do POST ao backend

**Por que terceiro:** o frontend depende do backend persistir os campos. Se fosse ao contrário, eventos de CAPI no webhook seriam disparados sem `event_id` (ou com um gerado na hora, diferente do que o pixel usou).

### 4. GTM

Por último, publicar as mudanças no GTM:
- Criar/atualizar variáveis `DLV - event_id`
- Verificar que todas as tags Meta passam `{ eventID: {{DLV - event_id}} }` no 4º argumento do `fbq()`

**Por que por último:** o GTM só precisa do `event_id` estar presente no `dataLayer` — o que o frontend já garantiu. Publicar o GTM antes do frontend funciona, mas as tags não terão `event_id` até o frontend entrar no ar. Ao contrário, se o frontend entrar antes do GTM estar publicado com a variável configurada, o pixel dispara sem `eventID` e a deduplicação falha pelo lado do browser. A janela de risco é a que existe entre o deploy do frontend e a publicação do GTM — por isso, minimizar essa janela publicando os dois na mesma janela de manutenção.

---

## Purchase em 3 Canais: Por que é Intencional

Um desenvolvedor revisando os logs pode estranhar ao ver o evento `Purchase` sendo enviado via CAPI três vezes para o mesmo pagamento:

1. Via polling (quando o frontend detecta confirmação e o backend envia CAPI)
2. Via webhook (quando o Asaas notifica o backend minutos depois)
3. Via pixel browser (GTM + fbq no frontend)

Isso é completamente intencional, e funciona assim:

**Canais 1 e 2 (CAPI):** usam o mesmo `event_id`. A Meta deduplica e conta como uma conversão.

**Canal 3 (browser):** também usa o mesmo `event_id` via `{ eventID: {{DLV - event_id}} }`. A Meta deduplica junto com os eventos CAPI.

**Resultado:** 3 envios, 1 conversão registrada.

**Por que não simplificar para apenas 1 canal?**

- Canal 1 (polling) cobre: usuário permanece no site e vê a tela de sucesso
- Canal 2 (webhook) cobre: usuário fechou a aba depois de pagar; pagamentos assíncronos (boleto); falhas de rede no canal 1
- Canal 3 (browser) cobre: atribuição com dados de sessão do browser; matching com `fbp`/`fbc` que não chegaram via CAPI

Se apenas o webhook existisse (canal 2), pagamentos PIX confirmados instantaneamente enquanto o usuário ainda está na tela de sucesso teriam latência de minutos até o evento chegar na Meta — prejudicando campanhas de otimização em tempo real.

Se apenas o polling existisse (canal 1), qualquer usuário que feche a aba antes da confirmação perderia a conversão completamente.

A redundância é o ponto.

---

## Trade-offs: Quando NÃO implementar CAPI

CAPI adiciona complexidade de backend significativa. Em alguns cenários, não vale a pena:

**Sites puramente informativos (sem transações):** PageView e ViewContent têm valor marginal via CAPI. Ad blockers não afetam materialmente a qualidade do dado para eventos de topo de funil.

**Projetos sem backend próprio:** se o site usa apenas serviços de terceiros (Shopify, Hotmart, Kiwify), o CAPI já está implementado pela plataforma. Duplicar no backend próprio geraria duplicatas.

**Audiências sem ad blocker significativo:** se a análise de tráfego mostra que menos de 5% dos usuários usam ad blockers e o produto não é voltado a público técnico, o ganho marginal do CAPI server-side pode não justificar o custo de implementação.

**Orçamento de ads muito pequeno:** abaixo de R$2.000/mês em Meta Ads, a diferença de qualidade de dado raramente se traduz em melhora mensurável de ROAS. O tempo de implementação teria ROI melhor investido em criativo ou segmentação.

**Quando CAPI é obrigatório:**

- Produto digital com checkout próprio (SaaS, infoproduto, assinatura)
- Qualquer checkout com opção PIX (alta taxa de abandono de aba)
- Audiência técnica (desenvolvedores, startups, B2B tech)
- Ticket médio alto (acima de R$200) onde cada conversão perdida tem impacto relevante
- Campanhas de performance com objetivo de Conversões (não Tráfego)

---

## Limitações Conhecidas e Mitigações

**`fbp` ausente em Safari + iOS:** o Safari limita o cookie `_fbp` a 7 dias via ITP. Para usuários recorrentes ou que demoram para converter, o `fbp` pode não existir. Mitigação: sempre coletar email e telefone no checkout — a Meta usa esses campos para matching mesmo sem `fbp`.

**IP dinâmico / VPN:** `client_ip_address` tem qualidade variável quando o usuário usa VPN ou está em rede corporativa com NAT. Não há mitigação — é uma limitação estrutural. Priorizar `external_id` (hash do ID de usuário) como campo de matching mais confiável.

**Eventos duplicados em desenvolvimento:** em hot reload (Vite, Next.js), o componente pode montar e desmontar várias vezes, disparando múltiplos `dataLayer.push()` para o mesmo evento. Em produção isso não ocorre. Solução para dev: usar `useEffect` com dependência vazia e flag de `fired` para garantir disparo único.

**Rate limiting da CAPI:** a Meta tem limites por pixel. Para volumes muito altos (acima de 1.000 eventos/hora), implementar batching. Para a maioria dos casos de infoproduto/SaaS pequeno, o fire-and-forget individual é suficiente.
