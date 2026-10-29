# Validação e Testes — Guia Completo

Guia para validar toda a pilha de rastreamento antes de ir para produção: Meta Test Events, GTM Preview, debug no browser e checklist completo.

---

## 1. Meta Test Events

### O que é

A aba "Test Events" no Events Manager mostra em tempo real os eventos marcados com um `test_event_code`. Atenção: esses eventos **não são descartados**. Segundo a documentação da Meta, eles também entram nos dados do pixel e são usados para segmentação e mensuração. Faça poucos testes no pixel de produção, ou use um pixel separado para testar.

### Como acessar

Events Manager (business.facebook.com/events_manager) → selecione seu pixel → aba "Test Events"

### Passo a passo

1. Na aba Test Events, copie o código exibido (formato: `TEST12345`)
2. No arquivo `.env` do backend, adicione:
   ```
   META_CAPI_TEST_CODE=TEST12345
   ```
3. Certifique-se de que o backend está usando essa variável ao montar o payload do CAPI:
   ```typescript
   const payload = {
     data: [eventData],
     ...(process.env.META_CAPI_TEST_CODE && {
       test_event_code: process.env.META_CAPI_TEST_CODE
     })
   };
   ```
4. Faça o fluxo completo: acesse a página de produto, inicie o checkout, preencha os dados, conclua o pagamento
5. Observe os eventos chegando em tempo real no painel de Test Events

### O que verificar no painel

- **Browser pixel e CAPI aparecem juntos** para o mesmo evento? Se sim, a deduplicação pelo `event_id` está funcionando.
- **Mesmo `event_id`** nos dois canais? Clique no evento e verifique os detalhes — o campo `Event ID` deve ser idêntico no evento browser e no evento CAPI.
- **EMQ (Event Match Quality)**: objetivo mínimo de 7 para Purchase. Abaixo de 6 indica problema de dados de matching (ver guia de hashing).
- **Campos de user data presentes**: `em` (email), `ph` (telefone), `fn`, `ln`, `fbp`, `fbc`. Quanto mais campos, maior o EMQ.

### Remover antes do deploy em produção

```bash
# .env de produção — deve estar assim:
META_CAPI_TEST_CODE=
# ou simplesmente não ter a variável
```

Deixar o `test_event_code` em produção não zera as conversões: os eventos continuam entrando no pixel. Mas o código existe para teste, então tire ele de produção. E lembre que todo teste feito no pixel de produção vira dado real.

---

## 2. GTM Preview Mode

### Como ativar

1. GTM → no workspace, clique no botão "Visualizar" (canto superior direito)
2. Informe a URL do site (ex: `https://seu-site.com`)
3. O GTM abrirá o site em uma nova aba com um painel de debug flutuante
4. Qualquer ação no site aparece em tempo real no painel

### O que verificar por evento

Para cada evento do checkout (ViewContent, InitiateCheckout, AddPaymentInfo, Purchase), verifique:

**Aba "Summary" (resumo dos eventos)**
- O evento apareceu na lista? (ex: "Purchase" após conclusão do pagamento)
- A ordem dos eventos está correta?

**Aba "Tags" (ao clicar em um evento)**
- A tag correspondente está em verde ("Disparada")?
- Se estiver cinza ("Não disparada"), o trigger não foi ativado — verifique o nome do evento
- Se estiver vermelha ("Falhou"), houve erro de JavaScript — verifique o console do browser

**Aba "Variables" (ao clicar em um evento)**
- `DLV - event_id` tem um valor (ex: `7f3a2c...`)?
- `DLV - value` está correto (ex: `197.00`)?
- `DLV - currency` está como `BRL`?
- `DLV - user_data` tem o objeto com os campos hasheados?

**Aba "Data Layer" (histórico completo)**
- Mostra todos os `dataLayer.push()` executados em ordem
- Útil para verificar se o push foi feito com os campos corretos antes da tag executar

### Como verificar que o event_id chegou na tag Meta

No painel GTM → clique no evento → aba "Tags" → clique na tag "Meta - Purchase" → expanda "Detalhes de execução". Ou abra o DevTools do browser, aba Network, filtre por `facebook.com` e inspecione o payload da requisição.

---

## 3. Console do Browser — Debug Manual

Comandos úteis para rodar diretamente no DevTools (F12 → Console):

```javascript
// Ver o estado atual completo do dataLayer
console.log(window.dataLayer);

// Interceptar todos os pushes em tempo real (rodar antes de iniciar o fluxo)
const originalPush = window.dataLayer.push.bind(window.dataLayer);
window.dataLayer.push = function(...args) {
  console.log('[dataLayer push]', JSON.stringify(args, null, 2));
  return originalPush(...args);
};

// Ver apenas os eventos (sem as variáveis do GTM)
window.dataLayer
  .filter(item => item.event)
  .map(item => ({ event: item.event, event_id: item.event_id, value: item.value }));

// Verificar cookies Meta presentes
document.cookie.split(';').filter(c => c.trim().startsWith('_fb'));

// Verificar se o pixel foi carregado
typeof window.fbq; // deve retornar 'function'

// Verificar se o GTM foi carregado
typeof window.google_tag_manager; // deve retornar 'object'
```

### Verificar requisições de rede

DevTools → aba Network → filtre por:
- `facebook.com/tr` — requisições do pixel browser
- `connect.facebook.net` — carregamento do script do pixel
- o domínio da API do seu gateway de pagamento, se quiser ver as chamadas de pagamento

Para cada requisição `facebook.com/tr`, inspecione o payload e verifique se `ev` (event name), `cd` (custom data) e `ud` (user data) estão presentes.

---

## 4. Meta Pixel Helper (extensão Chrome)

### Como instalar

Chrome Web Store → buscar "Meta Pixel Helper" → instalar a extensão oficial da Meta.

### Como usar

1. Acesse o site com a extensão ativa
2. O ícone da extensão no toolbar mostra um número com a contagem de eventos disparados
3. Clique no ícone para ver o painel com todos os eventos

### O que verificar

- **Eventos disparados**: aparecem com nome, parâmetros e status (verde = OK, laranja = aviso, vermelho = erro)
- **Parâmetros presentes**: expandindo cada evento, verifique se `value`, `currency`, `content_ids` e `eventID` estão presentes
- **user_data presente**: verifique se a seção `User Parameters` aparece (indica que dados de matching foram enviados)
- **Pixel ID correto**: confirme que o ID do pixel no evento bate com o configurado no Events Manager

### Limitação importante

O Pixel Helper só vê eventos do **pixel browser** (JavaScript no frontend). Ele não tem acesso aos eventos do CAPI (enviados pelo backend). Para verificar o CAPI, use a aba Test Events no Events Manager.

---

## 5. Checklist Completo Antes de Ir para Produção

### GTM e Pixel Browser

- [ ] GTM Preview confirmou todos os eventos disparando (ViewContent, InitiateCheckout, AddPaymentInfo, Purchase)
- [ ] Todas as tags Meta têm o 4º parâmetro `{eventID: {{DLV - event_id}}}` configurado
- [ ] Variável `DLV - event_id` está populada em todos os eventos de conversão
- [ ] `ecommerce: null` é enviado no dataLayer antes de cada evento de ecommerce (necessário para GA4 não acumular dados do push anterior)
- [ ] Pixel base code (`fbq('init', 'PIXEL_ID')`) está no `<head>` de todas as páginas
- [ ] Tag "Meta - Advanced Matching" dispara no `user_identified` e o Pixel Helper mostra os parâmetros de correspondência no evento seguinte
- [ ] Tags GA4 de e-commerce com "Enviar dados de comércio eletrônico" (origem: camada de dados)
- [ ] Meta Pixel Helper confirma eventos disparando com parâmetros corretos

### CAPI e Deduplicação

- [ ] Meta Test Events mostrando tanto o evento browser quanto o CAPI para o mesmo evento
- [ ] `event_id` e `event_name` idênticos nos dois canais (browser pixel e CAPI)
- [ ] O Purchase do navegador usa o `checkoutId` salvo no backend, não um UUID gerado na hora
- [ ] Telefone normalizado sem "+" nos dois lados (o hash do navegador e o do servidor batem)
- [ ] EMQ >= 7 para o evento Purchase (verificar na aba Test Events)
- [ ] Campos de user data presentes no CAPI: pelo menos `em`, `fbp`, `client_ip_address`, `client_user_agent`

### Segurança e Ambiente

- [ ] `META_CAPI_TEST_CODE` removido ou vazio no `.env` de produção
- [ ] Token de acesso Meta em variável de ambiente (nunca hardcoded no código)
- [ ] Logs do backend não contêm PII em texto claro (email, telefone, nome)
- [ ] Dados hasheados estão sendo logados apenas como indicação de presença, não valor (ex: `email: [hash presente]`, não o hash em si)

### Webhooks e Backend

- [ ] Webhooks testados com fluxo real de pagamento (não apenas curl manual)
- [ ] Eventos CAPI disparando no webhook de confirmação de pagamento
- [ ] `capiEventId` sendo salvo no banco de dados junto com o pagamento (para diagnóstico futuro)

---

## 6. Problemas Comuns e Diagnóstico

| Sintoma | Diagnóstico provável | Solução |
|---|---|---|
| Eventos não aparecem no Test Events | Token Meta inválido ou `test_event_code` incorreto | Verificar valor das env vars; testar com curl manual (ver abaixo) |
| Eventos duplicados no Events Manager | `event_id` diferente entre browser e CAPI | O frontend deve ser a fonte de verdade do `event_id`; garantir que o mesmo ID gerado no push do dataLayer é enviado ao backend e depois ao CAPI |
| EMQ baixo (< 5) no Purchase | Poucos campos de matching ou normalização incorreta | Adicionar telefone; verificar normalização E.164; confirmar que `fbp` está sendo lido do cookie corretamente |
| `fbq` não está definido (erro no console) | Pixel base code ausente nessa página | Adicionar o código base no `<head>` de todas as páginas |
| Compras em dobro | O navegador gera um `event_id` novo no Purchase | Reusar o `checkoutId` que o backend salvou |
| Requisição recusada inteira | Algum `event_time` com mais de 7 dias | Mandar no dia; venda presencial (`physical_store`) aceita até 62 dias |
| CAPI não dispara no webhook | `capiEventId` nulo ou webhook não está chamando o serviço CAPI | Verificar se o checkout está salvando o `event_id` e se o webhook está lendo esse campo |
| Eventos chegando sem `user_data` | `buildUserData` retornando undefined ou vazio | Verificar se o objeto `user` está sendo passado para os `dataLayer.push()` no frontend e para o payload CAPI no backend |
| Tag GTM aparece como "não disparada" | Nome do evento no trigger diferente do evento no dataLayer | Verificar o nome exato: `Purchase` (Meta) vs `purchase` (GA4) — são case-sensitive |
| `value` chegando como `undefined` na tag Meta | DLV mal configurada ou campo ausente no push | Verificar o nome exato da chave no `dataLayer.push()` vs o caminho configurado na DLV no GTM |

### Teste manual do CAPI com curl

Use para verificar se o token e o pixel ID estão corretos, independente do código:

```bash
curl -X POST \
  "https://graph.facebook.com/v26.0/{PIXEL_ID}/events?access_token={ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "data": [{
      "event_name": "Purchase",
      "event_time": '"$(date +%s)"',
      "event_id": "test-manual-'"$(date +%s)"'",
      "action_source": "website",
      "user_data": {
        "em": ["973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b"],
        "client_user_agent": "Mozilla/5.0 (test)"
      },
      "custom_data": {
        "value": 197.00,
        "currency": "BRL"
      }
    }],
    "test_event_code": "TEST12345"
  }'
```

O hash acima é o SHA-256 real de `test@example.com`. Para `action_source: website`, a Meta exige `client_user_agent`.

Uma resposta `{"events_received": 1}` confirma que o token e o pixel ID estão corretos e o evento chegou ao painel de Test Events.

---

## 7. Venda que fecha no CRM

Fluxo completo em `crm-utms-e-vendas.md`. Checklist:

- [ ] Site aberto com `?utm_source=meta&utm_campaign=TESTE&fbclid=TESTE123&gclid=TESTE456`: o formulário chega no CRM com os campos preenchidos e o `fbc` começando por `fb.1.`
- [ ] Visita seguinte sem parâmetros não apaga a origem gravada
- [ ] Venda de teste enviada com `META_CAPI_TEST_CODE`: o Purchase aparece em Test Events com `event_id` `purchase_{idVenda}`, o `action_source` do canal real e o `fbc`
- [ ] Google com `GOOGLE_DATAMANAGER_VALIDATE_ONLY=true` volta sem erro
- [ ] Depois do primeiro envio real, a coluna de conversões da ação importada mostra a venda na campanha certa (pode levar algumas horas)
