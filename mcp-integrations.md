# MCPs e APIs Oficiais para Rastreamento

Como usar as APIs oficiais do Google e da Meta, direto ou por um servidor MCP, para auditar e manter o rastreamento com o Claude.

---

## 1. O que são MCPs no contexto de rastreamento

MCP (Model Context Protocol) é um protocolo aberto que permite que o Claude se conecte a serviços externos por meio de "servers". No rastreamento, um MCP deixa o Claude ler e mexer no GTM, no Meta e no GA4 em vez de só ler código.

**Com MCP, o Claude pode:**
- Listar e inspecionar tags, triggers e variáveis de um container GTM
- Criar variáveis DLV ou tags em massa
- Consultar quantos eventos `purchase` chegaram no GA4
- Exportar a configuração do container para documentação

**Sem MCP:** o Claude lê o código do projeto, chama as APIs por script (com o seu token) ou orienta a fazer na interface.

**Antes de instalar um servidor MCP de terceiro:** confira quem mantém, quando foi atualizado e quais permissões ele pede. Ele vai receber um token com acesso à sua conta de anúncios ou ao seu container.

---

## 2. Google Tag Manager: API

- **Nome**: Google Tag Manager API v2
- **Tipo**: REST
- **Endpoint base**: `https://tagmanager.googleapis.com/tagmanager/v2/`
- **Autenticação**: OAuth 2.0 ou conta de serviço (melhor para automação)
- **Documentação**: https://developers.google.com/tag-manager/api/v2

### O que a API permite

- Listar contas, containers e workspaces
- Listar, criar, atualizar e apagar tags, triggers, variáveis e pastas
- Criar e publicar versões do container

### Conta de serviço

1. Google Cloud Console → IAM e administrador → Contas de serviço → criar
2. Ative a Tag Manager API no projeto
3. No GTM: Administrador → Gerenciamento de usuários → adicione o email da conta de serviço com a permissão necessária ("Editar" para criar, "Publicar" para publicar)

### Casos de uso com IA

- "Liste todas as tags do container e me diga quais não têm trigger associado"
- "Crie as DLVs padrão para Meta Pixel neste container"
- "Verifique se todas as tags Meta passam `eventID` no 4º argumento do `fbq`"
- "Confira se as tags GA4 de e-commerce têm 'Enviar dados de comércio eletrônico' marcado"

---

## 3. Meta: Graph API e Conversions API

- **Versão**: `v26.0` em outubro de 2026. Cada versão vive cerca de 2 anos: https://developers.facebook.com/docs/graph-api/changelog/versions
- **Autenticação**: token gerado no Events Manager (Configurações do pixel → Conversions API) ou de um usuário do sistema do Business Manager
- **Documentação**: https://developers.facebook.com/docs/marketing-api/conversions-api

### Endpoint principal

| Endpoint | Método | Uso |
|---|---|---|
| `/{PIXEL_ID}/events` | POST | Enviar eventos para a CAPI (até 1.000 por requisição) |

Qualidade de correspondência (EMQ), cobertura de parâmetros e diagnósticos: confira no Events Manager. Os campos de leitura da API mudam entre versões; se for automatizar, valide contra a referência da versão que você usa.

### Tarefas que o Claude pode automatizar

- "Mande um evento de teste com `test_event_code` e me mostre a resposta"
- "Confira se o payload do Purchase tem `fbc`, `fbp`, `em`, `ph` e `client_user_agent`"
- "Leia o `backend-capi.ts` e diga se o `event_id` do webhook é o mesmo do navegador"

---

## 4. Google Ads: conversões do CRM

- **API**: Data Manager API
- **Endpoint**: `POST https://datamanager.googleapis.com/v1/events:ingest`
- **Escopo OAuth**: `https://www.googleapis.com/auth/datamanager`
- **Documentação**: https://developers.google.com/data-manager/api

Desde 15/06/2026, quem está começando não consegue mais enviar conversão offline pela API do Google Ads: o caminho novo é a Data Manager API. O envio está pronto em `scripts/enviar-venda-crm.ts` e explicado em `crm-utms-e-vendas.md`.

---

## 5. Google Analytics 4: Data API

- **Nome**: Google Analytics Data API v1
- **Autenticação**: conta de serviço
- **Endpoint**: `https://analyticsdata.googleapis.com/v1beta/`
- **Documentação**: https://developers.google.com/analytics/devguides/reporting/data/v1

O Google também publicou um servidor MCP oficial para o GA4 (`google-analytics-mcp`), que usa essa API.

### Casos de uso para rastreamento

- Verificar se o evento `purchase` está chegando no GA4 depois de mudanças no GTM
- Comparar conversões GA4 x Meta x vendas do CRM para achar discrepância
- Auditar se `transaction_id` e `value` estão presentes nos eventos

### Exemplo de consulta

```bash
curl -X POST \
  "https://analyticsdata.googleapis.com/v1beta/properties/{GA4_PROPERTY_ID}:runReport" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "dateRanges": [{"startDate": "7daysAgo", "endDate": "today"}],
    "dimensions": [{"name": "eventName"}],
    "metrics": [{"name": "eventCount"}]
  }'
```

### Acesso da conta de serviço

1. Google Cloud Console → mesmo projeto → ative a Google Analytics Data API
2. No GA4: Administrador → Gerenciamento de acesso à propriedade → adicione o email da conta de serviço como "Leitor"

---

## 6. Configuração no Claude Code

Servidores MCP **não** ficam no `~/.claude/settings.json`. Há dois jeitos:

**Pelo terminal:**
```bash
claude mcp add nome-do-servidor -- comando argumentos
```

**Num arquivo `.mcp.json` na raiz do projeto** (compartilhado com o time pelo git):
```json
{
  "mcpServers": {
    "nome-do-servidor": {
      "command": "comando",
      "args": ["argumentos"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "${GOOGLE_APPLICATION_CREDENTIALS}"
      }
    }
  }
}
```

Use `${VARIAVEL}` para ler do ambiente: assim o token não entra no arquivo nem no git.

**Boas práticas de segurança:**
- Nunca commite token real em `.mcp.json` ou em qualquer arquivo
- Dê ao token só o acesso necessário (o pixel, não a conta de anúncios toda)
- Revogue tokens que não estão em uso

---

## 7. Tarefas que o Claude pode fazer

### Auditoria de container GTM

- "Liste todas as tags do container. Quais estão desativadas? Quais não têm trigger?"
- "Confirme que todas as tags Meta Pixel têm o 4º parâmetro `eventID` configurado com a variável DLV correta"
- "Mostre todas as variáveis DLV e confirme que os nomes batem com os campos do dataLayer do código"

### Criação e manutenção

- "Crie as DLVs padrão para Meta Pixel neste container: event_id, value, currency, content_ids, content_type, num_items, transaction_id, payment_method, user"
- "Crie a tag Meta - Advanced Matching no trigger user_identified"
- "Adicione um trigger de Evento Personalizado para o evento 'Lead'"

### Relatórios e comparações

- "Compare o número de eventos `purchase` no GA4 com as vendas do banco de dados"
- "Some as vendas do CRM por `utm_campaign` e compare com as conversões de cada campanha no Google Ads"
- "O parâmetro `transaction_id` está presente em todos os eventos de purchase do GA4?"
