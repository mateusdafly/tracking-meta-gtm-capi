# Validação e Testes — Guia Completo

Guia para validar toda a pilha de rastreamento antes de ir para produção: Meta Test Events, GTM Preview, debug no browser e checklist completo.

---

## 1. Meta Test Events

### O que é

A aba "Test Events" no Events Manager é um painel separado que recebe eventos marcados com um `test_event_code`. Esses eventos não entram nos dados reais de conversão — servem exclusivamente para verificar se o pipeline está funcionando.

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

Deixar o `test_event_code` em produção não causa dano nos dados (os eventos vão para o painel de teste, não para conversões reais), mas significa que as conversões reais não estão sendo registradas. Resultado: zero conversões reportadas, orçamento desperdiçado.

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
- `DLV - value` está correto (ex: `47.90`)?
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
- `api.asaas.com` — se quiser ver as chamadas de pagamento

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
- [ ] Pixel base code (`fbq('init', 'PIXEL_ID')`) está no `<head>` da página, antes do script do GTM
- [ ] Meta Pixel Helper confirma eventos disparando com parâmetros corretos

### CAPI e Deduplicação

- [ ] Meta Test Events mostrando tanto o evento browser quanto o CAPI para o mesmo evento
- [ ] `event_id` idêntico nos dois canais (browser pixel e CAPI)
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
| `fbq` não está definido (erro no console) | Pixel base code ausente ou carregando após o GTM | Adicionar base code no `<head>`, antes do script do GTM; nunca colocar `fbq('init')` dentro de uma tag GTM |
| CAPI não dispara no webhook | `capiEventId` nulo ou webhook não está chamando o serviço CAPI | Verificar se o checkout está salvando o `event_id` e se o webhook está lendo esse campo |
| Eventos chegando sem `user_data` | `buildUserData` retornando undefined ou vazio | Verificar se o objeto `user` está sendo passado para os `dataLayer.push()` no frontend e para o payload CAPI no backend |
| Tag GTM aparece como "não disparada" | Nome do evento no trigger diferente do evento no dataLayer | Verificar o nome exato: `Purchase` (Meta) vs `purchase` (GA4) — são case-sensitive |
| `value` chegando como `undefined` na tag Meta | DLV mal configurada ou campo ausente no push | Verificar o nome exato da chave no `dataLayer.push()` vs o caminho configurado na DLV no GTM |

### Teste manual do CAPI com curl

Use para verificar se o token e o pixel ID estão corretos, independente do código:

```bash
curl -X POST \
  "https://graph.facebook.com/v19.0/{PIXEL_ID}/events" \
  -H "Content-Type: application/json" \
  -d '{
    "data": [{
      "event_name": "Purchase",
      "event_time": '"$(date +%s)"',
      "event_id": "test-manual-'"$(date +%s)"'",
      "action_source": "website",
      "user_data": {
        "em": ["b4c9a289323b21a01c3e940f150eb9b8c542587f1abfd8f0e1cc1ffc5e475514"]
      },
      "custom_data": {
        "value": 47.90,
        "currency": "BRL"
      }
    }],
    "test_event_code": "TEST12345",
    "access_token": "{ACCESS_TOKEN}"
  }'
```

Uma resposta `{"events_received": 1}` confirma que o token e o pixel ID estão corretos e o evento chegou ao painel de Test Events.
