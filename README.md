# tracking-meta-gtm-capi

Skill de rastreamento full-stack para Claude Code: **Meta Pixel + Conversions API server-side + Google Tag Manager + Data Layer**.

Cobre todo o funil de conversão com deduplicação perfeita entre browser e backend, tratamento seguro de PII e exemplos prontos para produção.

---

## O que está nessa skill

### Documentação

| Arquivo | Conteúdo |
|---|---|
| `SKILL.md` | Guia principal: setup, padrões, CAPI, deduplicação, erros comuns |
| `architecture.md` | Por que dual-channel, fluxo completo do event_id, ordem de deploy |
| `datalayer-patterns.md` | Catálogo de eventos, anti-patterns, convenções GA4 vs Meta |
| `gtm-setup.md` | Passo a passo do container GTM: variáveis, triggers e tags |
| `pii-hashing.md` | Regras de hashing SHA-256, normalização de telefone para E.164 |
| `meta-capi-backend.md` | API CAPI completa: autenticação, payload, EMQ, Test Events |
| `mcp-integrations.md` | GTM API, Meta Graph API e como usar com Claude via MCP |
| `validation-testing.md` | Test Events, GTM Preview Mode, checklist de produção |

### Scripts prontos para uso

| Script | O que faz |
|---|---|
| `scripts/frontend-tracking.ts` | Módulo TypeScript completo para React/SPA |
| `scripts/backend-capi.ts` | Serviço CAPI completo para Node.js/Express |
| `scripts/gtm-datalayer-vanilla.js` | Data Layer em Vanilla JS (funciona em qualquer stack) |
| `scripts/test-capi.sh` | Testa a CAPI manualmente com `curl`, sem precisar rodar o backend |
| `scripts/debug-datalayer.js` | Cola no DevTools → intercepta e exibe pushes em tempo real |

---

## Arquitetura em uma linha

GTM como hub central + CAPI server-side como canal de backup, com o mesmo `event_id` em todos os canais para deduplicação automática no Meta.

```
Browser pixel (GTM)  ─┐
CAPI via polling      ─┼──► Meta (deduplica por event_id)
CAPI via webhook      ─┘
```

---

## Como usar no Claude Code

Coloque a pasta `tracking-meta-gtm-capi/` dentro de `~/.claude/skills/`. O Claude Code descobre e carrega automaticamente quando você pedir algo relacionado a rastreamento, pixels ou CAPI.

```bash
# Clone direto para a pasta de skills
git clone https://github.com/mateusdafly/tracking-meta-gtm-capi \
  ~/.claude/skills/tracking-meta-gtm-capi
```

---

## Debug rápido no browser

Cole o `scripts/debug-datalayer.js` no Console do DevTools (F12) e navegue pelo site:

```
[dataLayer] Purchase 🛒👤🔑
  event_id (dedup CAPI): a1b2c3d4-...
  user (PII hasheado): { email: "7c211...", fn: "ab123..." }
  ecommerce: { transaction_id: "PAY_123", value: 47.90, ... }
```

Comandos disponíveis após colar:
- `dlDebug.events()` — ver todos os eventos disparados
- `dlDebug.find('Purchase')` — filtrar por nome
- `dlDebug.cookies()` — verificar `_fbp` e `_fbc`

---

## Teste da CAPI via curl

```bash
export META_CAPI_ACCESS_TOKEN="EAAxxxxxxxx"
export META_CAPI_PIXEL_ID="SEU_PIXEL_ID"
export META_CAPI_TEST_CODE="TEST12345"  # pegar no Events Manager
./scripts/test-capi.sh
```

---

## Eventos cobertos

| Etapa | Event Name | Browser (GTM) | CAPI Backend |
|---|---|---|---|
| Login/Cadastro | `CompleteRegistration` | ✅ | ✅ |
| Ver produto | `ViewContent` | ✅ | — |
| Abrir checkout | `InitiateCheckout` | ✅ | ✅ |
| Preencher form | `AddPaymentInfo` | ✅ | ✅ |
| Pagamento confirmado | `Purchase` | ✅ | ✅ polling + webhook |

---

## Licença

MIT — use, adapte e compartilhe à vontade.
