# Venda que fecha no CRM: UTMs, clique e conversão de volta

O caso deste guia: o anúncio leva para o site (ou para o WhatsApp), o lead entra no CRM, alguém do time fecha a venda dias depois, e essa venda precisa voltar para o Meta e para o Google **na campanha certa**.

Sem isso, as plataformas otimizam para lead, não para venda. E o seu relatório não diz qual campanha vende.

Scripts deste guia:

| Script | Onde roda | O que faz |
|---|---|---|
| `scripts/captura-origem.js` | site, todas as páginas | guarda UTMs e IDs de clique e preenche o formulário |
| `scripts/enviar-venda-crm.ts` | seu backend | lê a venda do CRM e manda para o Meta (CAPI) e o Google (Data Manager API) |

---

## A regra que mais confunde

**Mandar o ID da campanha junto da conversão não faz a plataforma achar a campanha.** O Meta e o Google atribuem a venda pelo clique e pelos dados do contato. A UTM vai junto, mas serve para você.

| O que você guarda | Para que serve | Quem usa |
|---|---|---|
| `fbclid`, que vira `fbc` | ligar a venda ao anúncio no Meta | Meta |
| `gclid`, `gbraid`, `wbraid` | ligar a venda ao anúncio no Google | Google |
| telefone e email (com hash) | casar a venda quando o clique se perdeu | Meta e Google |
| UTMs com os IDs de campanha, conjunto e anúncio | relatório de venda por campanha no CRM e conferência com o painel | você |

Por isso o lead precisa guardar **as duas coisas**: o clique, para atribuir, e as UTMs, para conferir. Se faltar o clique e os dados de contato, a venda chega sem campanha mesmo com a UTM certa.

---

## O caminho completo

```
Anúncio (URL com UTMs de ID)
  │  o Meta acrescenta fbclid, o Google acrescenta gclid
  ▼
Site: captura-origem.js guarda UTMs + clique por 90 dias
  │
  ▼
Formulário (campos ocultos) ou WhatsApp (código na mensagem)
  │
  ▼
CRM: lead criado com os campos de origem
  │
  ▼ dias depois
Venda marcada como ganha
  │  webhook do CRM ou rotina diária
  ▼
enviar-venda-crm.ts lê os campos de volta
  ├──► Meta CAPI: Purchase com fbc, telefone, email + UTMs em custom_data
  └──► Google Data Manager API: conversão com gclid, telefone, email
```

---

## Regra 1. URL dos anúncios: IDs, não nomes

### Meta

No anúncio, em **Rastreamento > Parâmetros de URL**:

```
utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}&utm_id={{campaign.id}}
```

- **Use ID, não nome.** O parâmetro de nome fica preso ao nome que o anúncio tinha quando foi publicado. Renomeou a campanha, o relatório quebra. O ID nunca muda.
- **O `fbclid` o Meta acrescenta sozinho.** Não deixe redirecionamento, encurtador de link ou plugin de "URL limpa" tirar ele da URL.
- Confira abrindo o anúncio publicado e olhando a URL que chega no site.

### Google

1. Deixe a **tag automática** ligada (Administrador > Configurações da conta). É ela que acrescenta o `gclid`. No iPhone, o Google às vezes manda `gbraid` ou `wbraid` no lugar; o script guarda os três.
2. No **sufixo do URL final**, no nível da conta:

```
utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}&utm_id={campaignid}
```

`{campaignid}`, `{creative}` e `{keyword}` são parâmetros ValueTrack: o Google troca pelo ID da campanha, pelo ID do anúncio e pela palavra-chave.

**Anúncio do Google aponta para o site, não para o WhatsApp.** O Google não aceita URL final que redireciona. O botão de WhatsApp fica no site, e o rastro passa pelo site antes.

---

## Regra 2. No site: capturar na primeira página

O `fbclid` e o `gclid` só existem na URL da primeira página. Na página seguinte eles somem. Se o visitante preenche o formulário duas páginas depois, ou volta amanhã, o rastro tem que estar guardado.

**Instale o `scripts/captura-origem.js` em todas as páginas**, o mais cedo possível: no `<head>`, ou numa tag HTML Personalizado do GTM com acionador "Inicialização - Todas as páginas".

O que ele faz:

- **Último toque:** visita com UTM ou ID de clique substitui a origem anterior.
- **Sem parâmetro não apaga:** visita direta ou orgânica mantém a última origem de anúncio.
- **Primeiro toque:** é gravado uma vez só, nos campos `ft_*`.
- **`fbc` montado na hora:** sai no formato `fb.1.{timestamp_ms}.{fbclid}`, com o fbclid exatamente como veio, sem mudar maiúsculas.
- **Onde guarda:** em `localStorage` e num cookie de primeira parte, por 90 dias.

### Formulário

Crie no formulário um campo oculto para cada nome abaixo. O script preenche sozinho quando o visitante clica no formulário e de novo no envio.

```html
<input type="hidden" name="utm_source">
<input type="hidden" name="utm_medium">
<input type="hidden" name="utm_campaign">
<input type="hidden" name="utm_content">
<input type="hidden" name="utm_term">
<input type="hidden" name="utm_id">
<input type="hidden" name="fbclid">
<input type="hidden" name="fbc">
<input type="hidden" name="fbp">
<input type="hidden" name="gclid">
<input type="hidden" name="gbraid">
<input type="hidden" name="wbraid">
<input type="hidden" name="landing_page">
<input type="hidden" name="origem_capturada_em">
```

Formulário de ferramenta (RD Station, HubSpot, Typeform etc.): crie os mesmos campos como ocultos na ferramenta. Se ela roda dentro de um iframe de outro domínio, o script não alcança: passe os valores pela URL do iframe ou use o formulário nativo do site.

Se o formulário posta para o seu backend, guarde também o **user agent** e o **IP** da requisição. Melhoram o casamento no Meta. São dado pessoal: só com consentimento.

### WhatsApp

- **Opção A, a mais segura:** um formulário curto (nome e telefone) antes de abrir o WhatsApp. O lead já nasce no CRM com a origem.
- **Opção B:** link de WhatsApp com o atributo `data-origem`:

  ```html
  <a href="https://wa.me/5511999999999?text=Oi" data-origem>Falar no WhatsApp</a>
  ```

  No clique, a mensagem ganha um código (`(ref: K7Q2MX)`). Se `CONFIG.endpointWhatsapp` estiver definido, a origem vai para o seu backend com esse código. Quando a mensagem chega, o CRM (ou a integração do WhatsApp) casa o código com a origem.

**Anúncio de clique para WhatsApp, sem passar pelo site:** não existe `fbclid`. O ID do clique (`ctwa_clid`) chega no webhook do WhatsApp Business, e o evento vai com `action_source: business_messaging` pela [Conversions API for Business Messaging](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging). Os scripts deste repo não cobrem esse caso.

**Formulário instantâneo do Meta (Lead Ads):** guarde o ID do lead no campo `meta_lead_id`. Na venda, ele vai em `user_data.lead_id` e liga a venda ao formulário.

---

## Regra 3. No CRM: campos personalizados

Crie no CRM um campo para cada item. Os nomes podem mudar, mas o mapeamento tem que estar escrito.

| Campo | O que guarda | Quem preenche |
|---|---|---|
| `utm_source`, `utm_medium` | origem e meio | formulário |
| `utm_campaign` | ID da campanha | formulário |
| `utm_term` | ID do conjunto (Meta) ou palavra-chave (Google) | formulário |
| `utm_content` | ID do anúncio | formulário |
| `utm_id` | ID da campanha | formulário |
| `fbclid`, `fbc`, `fbp` | clique e navegador no Meta | formulário |
| `gclid`, `gbraid`, `wbraid` | clique no Google | formulário |
| `landing_page`, `origem_capturada_em` | página e hora do clique | formulário |
| `ft_utm_source`, `ft_utm_campaign`, `ft_capturada_em` | primeiro toque | formulário |
| `client_user_agent`, `client_ip_address` | navegador e IP | backend, com consentimento |
| `meta_lead_id` | ID do lead do formulário instantâneo | integração do Lead Ads |
| `consentimento` | aceitou uso dos dados para anúncios | formulário |
| `conversao_enviada_em` | quando a venda foi enviada | `enviar-venda-crm.ts` |

**Contato que volta por outro anúncio:** atualize os campos de clique e de UTM com o clique novo. É assim que o Meta e o Google atribuem: pelo último clique dentro da janela. O primeiro toque fica nos campos `ft_*`.

**Teste antes de ligar campanha:** abra o site com `?utm_campaign=TESTE&fbclid=TESTE123&gclid=TESTE456`, preencha o formulário e confira no CRM se os campos chegaram, com o `fbc` começando por `fb.1.`.

---

## Regra 4. Na venda: pegar de volta e enviar

### Quando disparar

- **Webhook do CRM:** quando a negociação muda para "ganha", o CRM chama o seu backend, que monta a venda e chama `enviarVenda()`.
- **Ou uma rotina diária:** busca as vendas ganhas nas últimas 24 h e manda.

O formato que o script espera (`VendaCRM` em `scripts/enviar-venda-crm.ts`):

```json
{
  "idVenda": "NEG-42",
  "valor": 1500,
  "moeda": "BRL",
  "fechadaEm": "2026-10-29T14:30:00-03:00",
  "canal": "chat",
  "contato": { "id": "CTT-7", "email": "cliente@exemplo.com", "telefone": "(11) 99999-9999", "nome": "Maria" },
  "origem": {
    "utm_source": "meta", "utm_campaign": "120210000000000001", "utm_content": "120210000000000003",
    "fbc": "fb.1.1761400000000.IwAR2AbC", "fbp": "fb.1.1761399990000.123456789",
    "gclid": null, "origem_capturada_em": "2026-10-25T12:00:00Z", "consentimento": true
  }
}
```

```bash
npx tsx scripts/enviar-venda-crm.ts venda.json
```

### O que vai para o Meta

| Campo | Valor | Por quê |
|---|---|---|
| `event_name` | `Purchase` | |
| `event_id` | `purchase_{idVenda}` | reenviar a mesma venda não duplica (janela de 48 h) |
| `event_time` | hora em que a venda fechou | não a hora do envio |
| `action_source` | canal real do fechamento | ver abaixo |
| `user_data` | `fbc`, `fbp`, email e telefone com hash, `external_id` (ID do contato com hash), `lead_id` | **é isso que acha a campanha** |
| `custom_data` | `value`, `currency`, `order_id` + as UTMs | as UTMs ficam para relatório e conversão personalizada |

**`action_source`, o canal onde a venda fechou:**

| Fechou por | Valor |
|---|---|
| WhatsApp, direct, chat | `chat` |
| telefone | `phone_call` |
| na loja ou no consultório | `physical_store` |
| pagamento no site | `website` (exige `client_user_agent`) |
| outro jeito | `other` |

**Prazo:** o `event_time` pode ter no máximo 7 dias. Se um evento da requisição for mais velho, o Meta recusa a requisição inteira. Mande no dia. Venda presencial (`physical_store`) aceita até 62 dias.

**UTMs em `custom_data`:** com elas você cria uma conversão personalizada no Events Manager ("Purchase onde `utm_campaign` = 1202...") e confere venda por campanha dentro do Meta. Elas não mudam a atribuição.

### O que vai para o Google

**Desde 15/06/2026, quem está começando não consegue mais enviar conversão offline pela API do Google Ads.** O caminho é a [Data Manager API](https://developers.google.com/data-manager/api): `POST https://datamanager.googleapis.com/v1/events:ingest`, escopo `https://www.googleapis.com/auth/datamanager`.

1. **Crie a ação de conversão** no Google Ads com origem "Importar de cliques" (tipo `UPLOAD_CLICKS`) e anote o ID dela.
2. **Configure o acesso** seguindo o "Set up API access" da Data Manager API. O script usa Application Default Credentials. Para testar na sua máquina:

   ```bash
   gcloud auth application-default login --scopes=https://www.googleapis.com/auth/datamanager,https://www.googleapis.com/auth/cloud-platform
   ```

3. **Defina as variáveis:** `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_CONVERSION_ACTION_ID` e, se o acesso for por MCC, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
4. **Primeiro envio com `GOOGLE_DATAMANAGER_VALIDATE_ONLY=true`:** valida tudo sem gravar nada.

| Campo | Valor |
|---|---|
| `adIdentifiers` | `gclid` (ou `gbraid`/`wbraid`) |
| `conversionValue`, `currency` | valor da venda |
| `eventTimestamp` | hora em que a venda fechou, ISO 8601 com fuso |
| `transactionId` | `idVenda`, o Google deduplica por ele |
| `userData.userIdentifiers` | email e telefone com hash |
| `consent` | `CONSENT_GRANTED` ou `CONSENT_DENIED`, conforme o lead aceitou |

**O telefone muda de formato.** Para o Google, o telefone vai em E.164 **com o "+"** antes do hash (`+5511999999999`). Para o Meta, vai **sem** (`5511999999999`). O script faz os dois. Ver `pii-hashing.md`.

**Sem `gclid`:** o Google ainda tenta casar por email e telefone (conversões otimizadas para leads). Para isso funcionar bem, ative as conversões otimizadas para leads na conta e na tag do Google do formulário, assim o Google recebe o email com hash já no momento do lead.

**Prazo:** a venda tem que caber na janela de conversão da ação, no máximo 90 dias depois do clique.

### Depois de enviar

Grave no CRM `conversao_enviada_em` e o resultado. O Meta só deduplica o mesmo `event_id` por 48 h: reenviar a mesma venda depois disso conta de novo.

---

## Regra 5. Conferir

1. **No CRM:** vendas e valor por `utm_campaign`. Como a UTM é o ID, ela bate direto com a campanha no painel.
2. **No Meta:** coluna de compras por campanha no Gerenciador de Anúncios e, se quiser, a conversão personalizada por `utm_campaign`.
3. **No Google:** coluna de conversões da ação importada, por campanha.

Diferença entre CRM e painel é normal: cada plataforma tem a sua janela de atribuição e nem toda venda casa. O sinal de problema é **uma campanha com venda no CRM e zero no painel**. Quase sempre é URL sem os parâmetros ou redirecionamento comendo o `fbclid`/`gclid`.

No Events Manager, acompanhe a qualidade de correspondência (EMQ) do Purchase e quantos eventos chegam com `fbc`.

---

## Teste ponta a ponta

- [ ] Site aberto com `?utm_source=meta&utm_campaign=TESTE&fbclid=TESTE123`
- [ ] Formulário enviado; no CRM, `utm_campaign=TESTE`, `fbclid=TESTE123` e `fbc` começando por `fb.1.`
- [ ] Venda de teste marcada como ganha com `META_CAPI_TEST_CODE` definido; o Purchase aparece em Test Events com `event_id` `purchase_{id}`
- [ ] Google com `GOOGLE_DATAMANAGER_VALIDATE_ONLY=true` volta sem erro (gclid de teste é inválido: o teste real é com um clique de verdade)
- [ ] `META_CAPI_TEST_CODE` removido. Evento com código de teste **não é descartado**: ele entra nos dados do pixel. Faça poucos testes, ou use um pixel de teste.

---

## LGPD

- **Consentimento antes do rastreio:** se o site pede, defina `window.ORIGEM_AGUARDAR_CONSENTIMENTO = true` e chame `window.origemRastreio.iniciar()` depois do aceite.
- **Hash não anonimiza:** SHA-256 de email ainda é dado pessoal. Os campos de origem no CRM merecem o mesmo controle de acesso que o telefone.
- **Consentimento no Google:** mande `CONSENT_DENIED` quando o lead não aceitou. O script faz isso pelo campo `consentimento`.

---

## Antes de construir: o CRM já faz?

Alguns CRMs já têm integração nativa com o Meta e o Google. Se o seu tem, confira duas coisas antes de usar: se ela guarda e devolve o `fbc`/`fbclid` e o `gclid`, e se manda a hora real da venda. Se fizer as duas, use a nativa. Se não, este guia é o caminho.
