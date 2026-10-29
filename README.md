# tracking-meta-gtm-capi

Skill de rastreamento full-stack para Claude Code: **Meta Pixel + Conversions API server-side + Google Tag Manager + Data Layer**, e agora também **venda que fecha no CRM** voltando para o Meta e o Google Ads na campanha certa.

Cobre o funil inteiro, com deduplicação entre navegador e backend, tratamento seguro de dado pessoal e exemplos prontos para produção.

---

## O que mudou em outubro de 2026

Uma auditoria completa achou bugs que quebravam produção. Se você usou a versão de março, confira estes pontos no seu código:

| Problema na versão antiga | Efeito | Correção |
|---|---|---|
| Os scripts geravam um `event_id` novo no navegador na hora do Purchase | o Meta contava a venda duas vezes (pixel + webhook) | um `checkoutId` por checkout, salvo no backend e usado em todos os canais |
| Graph API `v19.0` | versão fora de suporte | `v26.0`, configurável por `META_GRAPH_API_VERSION` |
| Telefone com "+" antes do hash no navegador | o telefone vindo do navegador nunca casava | só dígitos com DDI, igual ao backend |
| Hashes de exemplo errados (inclusive o de `test@example.com`) | código certo parecia errado no teste | hashes reais, calculados na hora no `test-capi.sh` |
| `debug-datalayer.js` trocava o `push` do GTM | as tags paravam de disparar durante o debug | passa cada push para o handler do GTM |
| `fbclid` cru usado como `fbc` | `fbc` inválido justamente com ad blocker | formato `fb.1.{timestamp_ms}.{fbclid}` |
| Tag GA4 com `items` como lista de IDs | dados de e-commerce tortos no GA4 | "Enviar dados de comércio eletrônico" lendo da camada de dados |
| Docs diziam que evento com `test_event_code` não conta | dado de teste ia para produção sem ninguém saber | o Meta não descarta esses eventos: eles entram nos dados do pixel |
| `event_time` sempre "agora" | venda confirmada depois saía com a hora errada | hora real da venda, com aviso do limite de 7 dias |
| Advanced Matching nunca ligado | o objeto `user` ia para o dataLayer e nenhuma tag lia | tag "Meta - Advanced Matching" no `gtm-setup.md` |

E o que é novo:

- **`crm-utms-e-vendas.md`:** as regras para passar UTMs e IDs de clique para o CRM e mandar a venda de volta.
- **`scripts/captura-origem.js`:** guarda UTMs e IDs de clique no site e preenche o formulário.
- **`scripts/enviar-venda-crm.ts`:** manda a venda para o Meta (CAPI) e para o Google (Data Manager API).
- **Evento `Lead`** no navegador e no backend.

---

## O que está nessa skill

### Documentação

| Arquivo | Conteúdo |
|---|---|
| `SKILL.md` | Guia principal: setup, padrões, CAPI, deduplicação, CRM, erros comuns |
| `crm-utms-e-vendas.md` | Venda que fecha no CRM: UTMs, fbclid/gclid, envio para Meta e Google |
| `architecture.md` | Por que dual-channel, fluxo completo do event_id, ordem de deploy |
| `datalayer-patterns.md` | Catálogo de eventos, anti-patterns, convenções GA4 vs Meta |
| `gtm-setup.md` | Passo a passo do container GTM: variáveis, triggers e tags |
| `pii-hashing.md` | Hashing SHA-256 e normalização; o telefone muda entre Meta e Google |
| `meta-capi-backend.md` | API CAPI completa: autenticação, payload, EMQ, Test Events |
| `mcp-integrations.md` | APIs do GTM, Meta e GA4 e como ligar no Claude Code |
| `validation-testing.md` | Test Events, GTM Preview Mode, checklist de produção |

### Scripts prontos para uso

| Script | O que faz |
|---|---|
| `scripts/captura-origem.js` | Guarda UTMs e IDs de clique no site e preenche os campos ocultos do formulário |
| `scripts/enviar-venda-crm.ts` | Manda a venda do CRM para o Meta (CAPI) e o Google (Data Manager API) |
| `scripts/frontend-tracking.ts` | Módulo TypeScript completo para React/SPA |
| `scripts/backend-capi.ts` | Serviço CAPI completo para Node.js/Express |
| `scripts/gtm-datalayer-vanilla.js` | Data Layer em Vanilla JS (funciona em qualquer stack) |
| `scripts/test-capi.sh` | Testa a CAPI manualmente com `curl`, sem precisar rodar o backend |
| `scripts/debug-datalayer.js` | Cola no DevTools → intercepta e exibe pushes em tempo real |

---

## Arquitetura em uma linha

GTM como hub central + CAPI server-side como canal de backup, com o mesmo `event_id` (e o mesmo `event_name`) em todos os canais para o Meta deduplicar.

```
Browser pixel (GTM)  ─┐
CAPI via polling      ─┼──► Meta (deduplica por event_name + event_id, 48 h)
CAPI via webhook      ─┘
```

Venda que fecha no CRM:

```
Anúncio (UTMs de ID) → site guarda UTMs + fbclid/gclid → lead no CRM
  → venda ganha → Purchase para o Meta (fbc, telefone, email) e para o Google (gclid, telefone, email)
```

Quem acha a campanha é o clique e os dados do contato. As UTMs vão junto para o seu relatório.

---

## Como usar no Claude Code

Coloque a pasta `tracking-meta-gtm-capi/` dentro de `~/.claude/skills/`. O Claude Code descobre e carrega automaticamente quando você pedir algo relacionado a rastreamento, pixels, CAPI ou envio de vendas do CRM.

```bash
# Clone direto para a pasta de skills
git clone https://github.com/mateusdafly/tracking-meta-gtm-capi \
  ~/.claude/skills/tracking-meta-gtm-capi
```

Já tinha clonado? `git pull` dentro da pasta.

---

## Debug rápido no browser

Cole o `scripts/debug-datalayer.js` no Console do DevTools (F12) depois que a página carregou e navegue pelo site:

```
[dataLayer] Purchase 🔑
  event_id (dedup CAPI): a1b2c3d4-...
  campos: { value: 197, currency: "BRL", transaction_id: "PAY_123", ... }
```

Comandos disponíveis após colar:
- `dlDebug.events()`: ver todos os eventos disparados
- `dlDebug.find('Purchase')`: filtrar por nome
- `dlDebug.cookies()`: verificar `_fbp` e `_fbc`
- `dlDebug.stop()`: parar e devolver o `push` original do GTM

---

## Teste da CAPI via curl

```bash
export META_CAPI_ACCESS_TOKEN="EAAxxxxxxxx"
export META_CAPI_PIXEL_ID="SEU_PIXEL_ID"
export META_CAPI_TEST_CODE="TEST12345"  # pegar no Events Manager
./scripts/test-capi.sh
```

Evento com `test_event_code` aparece em Test Events **e também entra nos dados do pixel**. Faça poucos testes, ou use um pixel de teste.

---

## Eventos cobertos

| Etapa | Event Name | Browser (GTM) | CAPI Backend |
|---|---|---|---|
| Formulário de contato | `Lead` | ✅ | ✅ |
| Login/Cadastro | `CompleteRegistration` | ✅ | ✅ |
| Ver produto | `ViewContent` | ✅ | ❌ |
| Abrir checkout | `InitiateCheckout` | ✅ | ✅ |
| Preencher form | `AddPaymentInfo` | ✅ | ✅ |
| Pagamento confirmado | `Purchase` | ✅ | ✅ polling + webhook |
| Venda fechada no CRM | `Purchase` | ❌ | ✅ `enviar-venda-crm.ts` (Meta + Google) |

---

## Licença

MIT. Use, adapte e compartilhe à vontade. Ver `LICENSE`.
