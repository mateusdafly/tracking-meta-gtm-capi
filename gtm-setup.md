# GTM Setup — Guia Completo de Configuração

Guia prático para configurar um container Google Tag Manager do zero para rastreamento com Meta Pixel e GA4.

---

## 1. Estrutura do Container GTM

- **Container**: unidade principal identificada por um ID no formato `GTM-XXXXXXX`. Um container contém todas as configurações de rastreamento de um site.
- **Workspace**: área de rascunho onde você faz alterações sem afetar o que está em produção. Cada workspace tem suas próprias edições pendentes.
- **Versão**: snapshot imutável do container. Criada ao publicar. Pode-se fazer rollback para qualquer versão anterior.
- **Preview Mode**: ambiente de teste que injeta o container em desenvolvimento em qualquer URL do site. Nenhuma alteração vai ao ar até você publicar.

Ordem de trabalho recomendada: crie e teste no workspace → ative o Preview para validar → publique uma nova versão.

---

## 2. Variáveis (Data Layer Variables — DLV)

Todas as variáveis abaixo são do tipo **Data Layer Variable**. O "Caminho no dataLayer" é o nome exato da chave que o código frontend vai incluir no `dataLayer.push()`.

| Nome no GTM | Tipo | Caminho no dataLayer | Uso |
|---|---|---|---|
| DLV - event_id | DLV | event_id | Deduplicação CAPI (campo crítico) |
| DLV - value | DLV | value | Meta + GA4 |
| DLV - currency | DLV | currency | Meta + GA4 |
| DLV - content_ids | DLV | content_ids | Meta |
| DLV - content_name | DLV | content_name | Meta |
| DLV - content_type | DLV | content_type | Meta |
| DLV - num_items | DLV | num_items | Meta |
| DLV - transaction_id | DLV | transaction_id | Meta + GA4 |
| DLV - payment_method | DLV | payment_method | Meta |
| DLV - user_data | DLV | user | Meta (objeto user com campos hasheados) |
| DLV - method | DLV | method | CompleteRegistration |
| DLV - content_ids (array) | DLV | content_ids | Formato array para Meta |

**Como criar uma DLV:**
1. GTM → Variáveis → Nova
2. Tipo: "Variável da Camada de Dados"
3. Nome da variável da camada de dados: exatamente o valor da coluna "Caminho no dataLayer"
4. Versão da camada de dados: versão 2
5. Salvar com o nome da coluna "Nome no GTM"

---

## 3. Triggers (Gatilhos de Evento Personalizado)

Todos os triggers abaixo são do tipo **Evento Personalizado**. O campo "Nome do evento" deve ser exatamente igual ao nome do evento usado no `dataLayer.push({ event: '...' })`.

| Nome do Trigger no GTM | Tipo | Nome do evento |
|---|---|---|
| CE - user_identified | Evento Personalizado | `user_identified` |
| CE - Lead | Evento Personalizado | `Lead` |
| CE - Purchase (Meta) | Evento Personalizado | `Purchase` |
| CE - InitiateCheckout | Evento Personalizado | `InitiateCheckout` |
| CE - AddPaymentInfo | Evento Personalizado | `AddPaymentInfo` |
| CE - CompleteRegistration | Evento Personalizado | `CompleteRegistration` |
| CE - ViewContent | Evento Personalizado | `ViewContent` |
| CE - purchase (GA4) | Evento Personalizado | `purchase` |
| CE - begin_checkout (GA4) | Evento Personalizado | `begin_checkout` |
| CE - add_payment_info (GA4) | Evento Personalizado | `add_payment_info` |
| CE - generate_lead (GA4) | Evento Personalizado | `generate_lead` |

**Atenção:** Meta usa CamelCase (`Purchase`, `InitiateCheckout`), GA4 usa snake_case (`purchase`, `begin_checkout`). São triggers separados mesmo que o evento seja semanticamente o mesmo.

**Como criar um trigger de Evento Personalizado:**
1. GTM → Acionadores → Novo
2. Tipo: "Evento personalizado"
3. Nome do evento: exatamente como na tabela
4. Isso aciona em: "Todos os eventos personalizados"
5. Salvar com o nome da coluna "Nome do Trigger"

---

## 4. Tags Meta Pixel (HTML Personalizado)

Cada evento Meta é uma tag separada do tipo **HTML Personalizado**. Use as variáveis GTM com a sintaxe `{{Nome da Variável}}` dentro do script.

### Regra crítica: o 4º parâmetro do fbq

A chamada `fbq('track', ...)` aceita 4 parâmetros. O 4º é o objeto de opções onde o `eventID` deve ser passado para deduplicação com o CAPI:

```javascript
fbq('track', 'NomeDoEvento', { /* dados */ }, { eventID: '...' });
```

Se o `eventID` não for passado, o CAPI e o pixel vão criar eventos duplicados no Events Manager.

### Tag: Advanced Matching

O objeto `user` do dataLayer não vai sozinho para o pixel. Esta tag passa os valores (já com hash) para o `fbq`.

- **Nome da tag**: `Meta - Advanced Matching`
- **Trigger**: `CE - user_identified`

```html
<script>
  var u = {{DLV - user_data}} || {};
  var dados = {};
  if (u.email) dados.em = u.email;
  if (u.phone) dados.ph = u.phone;
  if (u.fn) dados.fn = u.fn;
  if (u.ln) dados.ln = u.ln;
  if (u.external_id) dados.external_id = u.external_id;
  fbq('init', 'SEU_PIXEL_ID', dados);
</script>
```

Chamar `fbq('init')` de novo com o mesmo pixel e o objeto de correspondência acrescenta os dados do usuário aos eventos seguintes. Confira no Meta Pixel Helper: o evento depois do `user_identified` deve mostrar os parâmetros de correspondência avançada.

### Tag: Lead

- **Nome da tag**: `Meta - Lead`
- **Trigger**: `CE - Lead`

```html
<script>
  fbq('track', 'Lead', {}, {
    eventID: {{DLV - event_id}}   // lead_{idLead}, o mesmo que o backend manda na CAPI
  });
</script>
```

### Tag: Purchase

- **Nome da tag**: `Meta - Purchase`
- **Trigger**: `CE - Purchase (Meta)`

```html
<script>
  fbq('track', 'Purchase', {
    value: {{DLV - value}},
    currency: {{DLV - currency}},
    content_ids: {{DLV - content_ids}},
    content_type: {{DLV - content_type}},
    num_items: {{DLV - num_items}},
  }, {
    eventID: {{DLV - event_id}}
  });
</script>
```

### Tag: InitiateCheckout

- **Nome da tag**: `Meta - InitiateCheckout`
- **Trigger**: `CE - InitiateCheckout`

```html
<script>
  fbq('track', 'InitiateCheckout', {
    value: {{DLV - value}},
    currency: {{DLV - currency}},
    content_ids: {{DLV - content_ids}},
    content_name: {{DLV - content_name}},
    content_type: {{DLV - content_type}},
    num_items: {{DLV - num_items}},
  }, {
    eventID: {{DLV - event_id}}
  });
</script>
```

### Tag: AddPaymentInfo

- **Nome da tag**: `Meta - AddPaymentInfo`
- **Trigger**: `CE - AddPaymentInfo`

```html
<script>
  fbq('track', 'AddPaymentInfo', {
    value: {{DLV - value}},
    currency: {{DLV - currency}},
    content_ids: {{DLV - content_ids}},
    content_type: {{DLV - content_type}},
    payment_method: {{DLV - payment_method}},
  }, {
    eventID: {{DLV - event_id}}
  });
</script>
```

### Tag: CompleteRegistration

- **Nome da tag**: `Meta - CompleteRegistration`
- **Trigger**: `CE - CompleteRegistration`

```html
<script>
  fbq('track', 'CompleteRegistration', {
    value: {{DLV - value}},
    currency: {{DLV - currency}},
    content_name: {{DLV - content_name}},
    status: true,
  }, {
    eventID: {{DLV - event_id}}
  });
</script>
```

### Tag: ViewContent

- **Nome da tag**: `Meta - ViewContent`
- **Trigger**: `CE - ViewContent`

```html
<script>
  fbq('track', 'ViewContent', {
    value: {{DLV - value}},
    currency: {{DLV - currency}},
    content_ids: {{DLV - content_ids}},
    content_name: {{DLV - content_name}},
    content_type: {{DLV - content_type}},
  }, {
    eventID: {{DLV - event_id}}
  });
</script>
```

**Observação:** o código base do Meta Pixel (o snippet com `fbq('init', 'PIXEL_ID')` e o PageView) fica no `<head>` de todas as páginas, junto do snippet do GTM. A ordem entre os dois não importa: o stub do `fbq` é criado na hora e o container do GTM carrega de forma assíncrona, então as tags sempre encontram o `fbq`. A única tag que chama `fbq('init')` de novo é a de Advanced Matching, e só para acrescentar os dados do usuário.

---

## 5. Tags GA4 (Evento GA4)

Use o tipo de tag nativa **"Evento do Google Analytics: GA4"** (não HTML Personalizado).

**Não monte os parâmetros de e-commerce na mão.** Em cada tag de e-commerce, abra "Mais configurações" → "E-commerce", marque **"Enviar dados de comércio eletrônico"** e escolha a origem **"Camada de dados"**. A tag lê o objeto `ecommerce` do push GA4 (`transaction_id`, `value`, `currency`, `items` como lista de objetos). Montar `items` com as DLVs do push do Meta manda uma lista de IDs, que o GA4 não entende, e lê `value` de outro push.

### Tag: purchase (GA4)

- **Nome da tag**: `GA4 - purchase`
- **Trigger**: `CE - purchase (GA4)`
- **ID de medição**: o da sua propriedade GA4
- **Nome do evento**: `purchase`
- **E-commerce**: "Enviar dados de comércio eletrônico", origem "Camada de dados"

### Tag: begin_checkout (GA4)

- **Nome da tag**: `GA4 - begin_checkout`
- **Trigger**: `CE - begin_checkout (GA4)`
- **Nome do evento**: `begin_checkout`
- **E-commerce**: "Enviar dados de comércio eletrônico", origem "Camada de dados"

### Tag: add_payment_info (GA4)

- **Nome da tag**: `GA4 - add_payment_info`
- **Trigger**: `CE - add_payment_info (GA4)`
- **Nome do evento**: `add_payment_info`
- **E-commerce**: "Enviar dados de comércio eletrônico", origem "Camada de dados" (o `payment_type` já vai dentro do objeto `ecommerce`)

### Tag: generate_lead (GA4)

- **Nome da tag**: `GA4 - generate_lead`
- **Trigger**: `CE - generate_lead (GA4)`
- **Nome do evento**: `generate_lead`

---

## 6. Ordem de Configuração Recomendada

1. **Variáveis** — crie todas as DLVs primeiro. Tags e triggers dependem delas.
2. **Triggers** — crie todos os eventos personalizados.
3. **Tags** — crie as tags e vincule aos triggers já existentes.
4. **Preview** — teste cada evento antes de publicar.
5. **Publicar** — crie uma nova versão com descrição clara (ex: "Adiciona rastreamento Meta + GA4 para checkout").

---

## 7. GTM Preview Mode

O Preview Mode permite testar sem afetar produção.

**Ativando:**
1. GTM → clique em "Visualizar" (botão azul no topo do workspace)
2. Informe a URL do site
3. O GTM abrirá uma aba com o site e outra com o painel de debug

**O que verificar no painel de debug:**
- Aba **Summary**: lista de eventos disparados em ordem cronológica
- Aba **Tags**: quais tags dispararam (verde), não dispararam (cinza) ou falharam (vermelho)
- Aba **Variables**: valor de cada variável no momento do evento
- Aba **Data Layer**: histórico completo de todos os pushes

**Fluxo de teste:**
1. Acesse a página de checkout
2. Avance cada etapa
3. No painel GTM, clique no evento correspondente e verifique:
   - O trigger disparou?
   - A variável `DLV - event_id` tem um valor?
   - A tag executou sem erro?

---

## 8. Export/Import do Container

**Exportar (backup e controle de versão):**
1. GTM → menu hamburguer → Exportar container
2. Selecione a versão (ou "Workspace atual" para estado não publicado)
3. Salva um arquivo `.json` — commite no repositório junto com o código do projeto

**Importar (restaurar ou migrar):**
1. GTM → menu hamburguer → Importar container
2. Selecione o arquivo `.json`
3. Escolha o workspace de destino
4. Escolha entre "Mesclar" (mantém o que existe) ou "Substituir" (apaga tudo)
5. Revise as alterações antes de confirmar

**Dica:** mantenha o JSON exportado em `/docs/gtm-container-backup.json` no repositório. Assim qualquer dev consegue restaurar a configuração exata se o container for corrompido ou sobrescrito por acidente.
