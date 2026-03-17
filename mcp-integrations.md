# MCPs e APIs Oficiais para Rastreamento

Guia sobre como usar Model Context Protocol (MCP) servers e APIs oficiais do Google e Meta para automatizar e gerenciar rastreamento com IA.

---

## 1. O que são MCPs no contexto de rastreamento

MCP (Model Context Protocol) é um protocolo aberto que permite que modelos de IA como Claude se conectem a serviços externos por meio de "servers" especializados. No contexto de rastreamento, MCPs permitem que Claude acesse diretamente as APIs do GTM, Meta e GA4, em vez de apenas ler código ou documentação.

**Com MCPs de rastreamento, Claude pode:**
- Listar e inspecionar tags, triggers e variáveis de um container GTM
- Criar variáveis DLV ou tags em massa sem o dev precisar clicar na interface
- Consultar o Event Match Quality dos últimos dias direto no chat
- Verificar se eventos CAPI estão chegando corretamente
- Exportar a configuração do container para documentação

**Sem MCP (situação atual mais comum):**
Claude lê o código do projeto e orienta o dev a fazer as ações manualmente na interface.

**Com MCP:**
Claude executa as ações diretamente, o dev apenas confirma.

---

## 2. Google Tag Manager — API e MCP

### API oficial

- **Nome**: Google Tag Manager API v2
- **Tipo**: REST
- **Endpoint base**: `https://tagmanager.googleapis.com/tagmanager/v2/`
- **Autenticação**: Google OAuth 2.0 ou Service Account (recomendado para automação)
- **Documentação**: https://developers.google.com/tag-manager/api/v2

### O que a API permite

- Listar accounts, containers, workspaces
- Listar, criar, atualizar e deletar: tags, triggers, variáveis, pastas
- Publicar versões de container
- Fazer preview de workspace
- Exportar e importar containers (JSON)

### Configuração de Service Account

1. Acesse Google Cloud Console → IAM & Admin → Service Accounts
2. Crie uma service account para o projeto
3. Baixe o arquivo JSON de credenciais
4. No GTM: Admin → Gerenciar permissões de usuário → adicione o email da service account com permissão de "Publicar" ou "Editar"

### Configuração MCP para GTM

```json
{
  "mcpServers": {
    "google-tag-manager": {
      "command": "npx",
      "args": ["-y", "@mcp/google-tag-manager"],
      "env": {
        "GTM_SERVICE_ACCOUNT_KEY": "/path/to/service-account.json",
        "GTM_ACCOUNT_ID": "123456789",
        "GTM_CONTAINER_ID": "GTM-XXXXXXX"
      }
    }
  }
}
```

**Nota:** o pacote `@mcp/google-tag-manager` é um exemplo de nomenclatura. Verifique os pacotes disponíveis no npm e no repositório oficial de servidores MCP (`github.com/modelcontextprotocol/servers`) — a comunidade cresce rapidamente e novos servidores são publicados com frequência.

### Casos de uso com IA

- "Liste todas as tags do container e me diga quais não têm trigger associado"
- "Crie as 12 variáveis DLV padrão para Meta Pixel neste container"
- "Exporte o container atual como JSON e salve em `docs/gtm-backup.json`"
- "Verifique se existe uma tag para o evento Purchase com o 4º parâmetro eventID configurado"
- "Publique a versão atual do workspace com a descrição: 'Adiciona rastreamento Meta CAPI'"

---

## 3. Meta Business — Conversions API e MCP

### API oficial

- **Nome**: Meta Graph API (Conversions API — CAPI)
- **Versão atual**: v19.0+
- **Autenticação**: System User Access Token (System User no Business Manager)
- **Documentação**: https://developers.facebook.com/docs/marketing-api/conversions-api

### Endpoints relevantes

| Endpoint | Método | Uso |
|---|---|---|
| `/{PIXEL_ID}/events` | POST | Enviar eventos para o CAPI |
| `/{PIXEL_ID}/diagnostics` | GET | Verificar status e alertas do pixel |
| `/{PIXEL_ID}/stats` | GET | Estatísticas de recebimento de eventos |
| `/me/adaccounts` | GET | Listar contas de anúncio |

### Verificar qualidade via API (curl de exemplo)

```bash
curl -G \
  "https://graph.facebook.com/v19.0/{PIXEL_ID}/diagnostics" \
  --data-urlencode "access_token={ACCESS_TOKEN}" \
  --data-urlencode "fields=events_missed_opportunity,event_match_quality"
```

### Configuração MCP para Meta CAPI

```json
{
  "mcpServers": {
    "meta-capi": {
      "command": "npx",
      "args": ["-y", "@mcp/meta-business-api"],
      "env": {
        "META_ACCESS_TOKEN": "SEU_TOKEN_AQUI",
        "META_PIXEL_ID": "SEU_PIXEL_ID"
      }
    }
  }
}
```

**Nota:** verifique os pacotes disponíveis — `@mcp/meta-business-api` é um exemplo de nomenclatura. Busque por "meta" ou "facebook" no repositório de servidores MCP da comunidade.

### Tarefas que Claude pode automatizar via MCP

- "Qual é o Event Match Quality do evento Purchase nos últimos 7 dias?"
- "Liste todos os eventos recebidos ontem e compare com o esperado"
- "Envie um evento de teste para verificar se o payload está correto"
- "Verifique se há alertas de qualidade de dados no painel de diagnósticos"
- "Mostre os campos de matching disponíveis por evento e suas taxas de cobertura"

---

## 4. Google Analytics 4 — Data API e MCP

### API oficial

- **Nome**: Google Analytics Data API v1
- **Autenticação**: Google Service Account
- **Endpoint**: `https://analyticsdata.googleapis.com/v1beta/`
- **Documentação**: https://developers.google.com/analytics/devguides/reporting/data/v1

### Casos de uso para rastreamento

- Verificar se o evento `purchase` está chegando no GA4 após mudanças no GTM
- Comparar número de conversões GA4 vs Meta para identificar discrepâncias
- Relatório automático de eventos por canal (organic, cpc, email)
- Auditar se parâmetros de ecommerce (`value`, `transaction_id`) estão presentes nos eventos

### Exemplo de consulta (via API)

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

### Autenticação com Service Account

1. Google Cloud Console → mesmo projeto da GTM API
2. Habilite a GA4 Data API
3. Na interface GA4: Admin → Gerenciamento de acesso à conta → adicione o email da service account com permissão de "Visualizador"

---

## 5. Configuração no Claude Code (settings.json)

O arquivo de configuração dos MCPs fica em `~/.claude/settings.json`. Exemplo com MCPs de rastreamento configurados:

```json
{
  "mcpServers": {
    "google-gtm": {
      "command": "node",
      "args": ["/path/to/gtm-mcp-server/index.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/home/user/.config/gcloud/service-account.json",
        "GTM_ACCOUNT_ID": "123456789",
        "GTM_CONTAINER_ID": "GTM-XXXXXXX"
      }
    },
    "meta-business": {
      "command": "node",
      "args": ["/path/to/meta-mcp-server/index.js"],
      "env": {
        "META_ACCESS_TOKEN": "EAABxxx...",
        "META_PIXEL_ID": "1234567890"
      }
    },
    "google-analytics": {
      "command": "node",
      "args": ["/path/to/ga4-mcp-server/index.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/home/user/.config/gcloud/service-account.json",
        "GA4_PROPERTY_ID": "123456789"
      }
    }
  }
}
```

**Boas práticas de segurança:**
- Nunca commite `settings.json` com tokens reais
- Use variáveis de ambiente do sistema em vez de tokens diretos no JSON quando possível
- Crie System Users na Meta com permissões mínimas necessárias (apenas o pixel, não a conta de anúncios toda)
- Revogue tokens que não estão em uso

---

## 6. Tarefas que Claude pode fazer com MCPs de rastreamento

### Auditoria de container GTM

- "Liste todas as tags do container. Quais estão desativadas? Quais não têm trigger?"
- "Confirme que todas as tags Meta Pixel têm o 4º parâmetro `eventID` configurado com a variável DLV correta"
- "Verifique se existe deduplicação: o event_id é enviado em todas as tags de conversão?"
- "Mostre todas as variáveis DLV e confirme que os nomes batem com os campos do dataLayer do código"

### Criação e manutenção de configurações

- "Crie as DLVs padrão para Meta Pixel neste container: event_id, value, currency, content_ids, content_type, num_items, transaction_id, payment_method, user"
- "Adicione um trigger de Evento Personalizado para o evento 'AddToCart'"
- "Atualize a tag Meta - Purchase para incluir o campo `content_name`"

### Verificação de qualidade (Meta)

- "Qual é o Event Match Quality do Purchase hoje? Está acima de 7?"
- "Mostre os campos de user data sendo enviados e as taxas de cobertura por campo"
- "Há eventos duplicados nos últimos 3 dias? Verificar se event_id está funcionando"

### Relatórios e comparações (GA4)

- "Compare o número de eventos `purchase` no GA4 com as confirmações de pagamento do banco de dados"
- "Qual canal está gerando mais conversões esta semana?"
- "O parâmetro `transaction_id` está presente em todos os eventos de purchase do GA4?"
