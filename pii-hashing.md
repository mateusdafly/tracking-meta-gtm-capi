# PII Hashing — Tratamento de Dados Pessoais para Rastreamento

Guia completo sobre como tratar dados pessoais (PII) antes de enviá-los ao Meta Pixel e à Conversions API.

---

## 1. Por que hashear PII

Meta e Google exigem que dados pessoais sejam hasheados com SHA-256 antes de serem enviados pelas APIs de servidor (CAPI, Data Manager API). No navegador, o pixel do Meta aceita o dado sem hash e calcula sozinho; se você hashear antes, use a mesma normalização do servidor. Os motivos para hashear:

- **Política obrigatória**: a Meta Business Terms of Service exige que dados pessoais identificáveis sejam hasheados. Enviar PII em texto claro viola os termos e pode resultar em suspensão do pixel.
- **SHA-256 é one-way**: a Meta consegue fazer o matching com seus próprios dados hasheados (a Meta tem os emails dos usuários logados no Facebook/Instagram), mas não consegue reverter o hash para obter o dado original. Isso é o que torna a CAPI legalmente viável.
- **Dado hasheado ainda é PII**: sob LGPD e GDPR, um hash SHA-256 de email ainda é considerado dado pessoal porque é determinístico — o mesmo input sempre gera o mesmo output, permitindo correlação. O hashing não anonimiza, mas cumpre os requisitos técnicos de Meta e Google.

**Regra prática**: se o dado identifica uma pessoa diretamente (email, nome, telefone), hashear antes de enviar. Se o dado é técnico ou anônimo (cookie, IP, user agent), enviar bruto.

---

## 2. O que hashear vs não hashear

### O que HASHEAR (SHA-256, após normalização)

Normalização padrão antes do hash: `.toLowerCase().trim()` (exceto telefone, que tem regra própria).

| Campo CAPI | Campo no objeto `user` | Dado | Normalização antes do hash |
|---|---|---|---|
| `em` | `user.email` | email | `.toLowerCase().trim()` |
| `fn` | `user.fn` | primeiro nome | `.toLowerCase().trim()` |
| `ln` | `user.ln` | último nome | `.toLowerCase().trim()` |
| `ph` | `user.phone` | telefone | normalizar para E.164 primeiro (ver seção 3) |
| `ct` | `user.ct` | cidade | `.toLowerCase().trim()` |
| `st` | `user.st` | estado/UF | `.toLowerCase().trim()` (ex: `sp`, não `SP`) |
| `country` | `user.country` | país | `.toLowerCase()` (ex: `br`) |
| `external_id` | `user.external_id` | ID interno do usuário | `.toLowerCase()` |

### O que NÃO hashear (enviar bruto)

| Campo CAPI | Fonte | Motivo |
|---|---|---|
| `fbp` | Cookie `_fbp` | Meta já conhece o formato interno; hashear quebra o matching |
| `fbc` | Cookie `_fbc` | Idem — é um identificador de clique que a Meta controla |
| `client_ip_address` | `req.ip` no Express | Meta usa para geolocalização; o IP já está no formato esperado |
| `client_user_agent` | `req.headers['user-agent']` | Meta usa para device matching; precisa da string original |

**Erro comum**: hashear `fbp` ou `fbc`. Isso faz com que a Meta não consiga fazer o matching de cliques de anúncios com conversões, derrubando a qualidade dos dados.

---

## 3. Normalização de Telefone para E.164

### Por que normalizar

O hash só casa se o texto for idêntico ao que a plataforma tem. Se você enviar `(11) 99999-8888` hasheado, a Meta não vai conseguir fazer match porque o hash será diferente do hash que ela tem para `5511999998888`.

### Meta e Google pedem formatos diferentes

| Plataforma | Formato antes do hash | Exemplo |
|---|---|---|
| Meta (pixel e CAPI) | só dígitos, com DDI, **sem** "+" | `5511999998888` |
| Google (Data Manager API) | E.164 **com** "+" | `+5511999998888` |

O "+" muda o hash. Mandar o formato do Google para o Meta (ou o contrário) faz o telefone parar de casar sem erro nenhum.

### Regras para Brasil

- Se o número veio com "+", o DDI já está nele: só remove o que não for dígito
- Remove todos os caracteres não-dígitos
- Se já começar com `55` e tiver 12 ou 13 dígitos: já está correto
- Se começar com `0` (discagem de longa distância): remove o `0`
- Senão: adiciona o prefixo `55`
- Para o Google: acrescenta o "+" no resultado

### Exemplos

| Input | Após normalização E.164 |
|---|---|
| `(11) 99999-8888` | `5511999998888` |
| `11 9 9999-8888` | `5511999998888` |
| `+55 11 99999-8888` | `5511999998888` |
| `5511999998888` | `5511999998888` (já correto) |
| `011 99999-8888` | `5511999998888` |
| `(55) 99999-8888` | `5555999998888` (DDD 55, RS) |
| `99999-8888` | sem DDD: não dá para normalizar com segurança, não envie |

### Código TypeScript (backend)

```typescript
// Formato do Meta: só dígitos, com DDI, sem "+"
function normalizePhoneBR(raw: string): string | null {
  const hadPlus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');

  if (hadPlus) return digits.length >= 8 ? digits : null; // DDI informado, qualquer país

  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits; // já tem o 55
  }

  if (digits.startsWith('0')) digits = digits.slice(1); // 0 de longa distância

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`; // DDD + número
  }

  // Não foi possível normalizar de forma segura
  return null;
}

// Formato do Google: E.164 com "+"
function normalizePhoneGoogle(raw: string): string | null {
  const meta = normalizePhoneBR(raw);
  return meta ? `+${meta}` : null;
}
```

### Código JavaScript (browser)

```javascript
function normalizePhoneBR(raw) {
  const hadPlus = raw.trim().startsWith('+');
  let digits = raw.replace(/\D/g, '');
  if (hadPlus) return digits.length >= 8 ? digits : null;
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return null;
}
```

---

## 4. Implementação no Browser (Web Crypto API)

A Web Crypto API está disponível em todos os browsers modernos (Chrome 37+, Firefox 34+, Safari 7+, Edge 79+). É assíncrona.

```javascript
async function sha256(value) {
  if (!value) return undefined;

  // Normalizar: lowercase + trim
  const normalized = value.toLowerCase().trim();

  // Codificar como bytes UTF-8
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);

  // Computar hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Converter para hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Uso
async function buildUserData(user) {
  return {
    em: user.email ? await sha256(user.email) : undefined,
    fn: user.firstName ? await sha256(user.firstName) : undefined,
    ln: user.lastName ? await sha256(user.lastName) : undefined,
    ph: user.phone ? await sha256(normalizePhoneBR(user.phone)) : undefined,
    external_id: user.id ? await sha256(String(user.id)) : undefined,
    // Não hashear:
    fbp: getCookie('_fbp') || undefined,
    fbc: getCookie('_fbc') || undefined,
  };
}
```

---

## 5. Implementação no Backend (Node.js crypto)

O módulo `crypto` do Node.js é síncrono e não requer dependências externas.

```typescript
import { createHash } from 'crypto';

function sha256(value: string): string {
  return createHash('sha256')
    .update(value.toLowerCase().trim())
    .digest('hex');
}

function buildUserDataHashed(user: {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  id?: string | number;
}) {
  const result: Record<string, string> = {};

  if (user.email) result.em = sha256(user.email);
  if (user.firstName) result.fn = sha256(user.firstName);
  if (user.lastName) result.ln = sha256(user.lastName);

  if (user.phone) {
    const normalized = normalizePhoneBR(user.phone);
    if (normalized) result.ph = sha256(normalized);
  }

  if (user.id) {
    result.external_id = sha256(String(user.id).toLowerCase());
  }

  return result;
}
```

**Nota importante para telefone no backend:** o `sha256` helper já chama `.toLowerCase().trim()`. Para telefone, chame `normalizePhoneBR` ANTES de passar para `sha256`, porque a normalização do telefone não é só lowercase — é remoção de caracteres e adição de prefixo.

---

## 6. Erros Comuns que Reduzem o EMQ (Event Match Quality)

O EMQ (Event Match Quality) é a pontuação de 0 a 10 que a Meta atribui à qualidade dos dados de matching. Erros de hashing e normalização são as causas mais comuns de EMQ baixo.

| Erro | Impacto | Como evitar |
|---|---|---|
| Hashear com espaços ou maiúsculas | Hash diferente do da Meta → matching falha | Sempre `.toLowerCase().trim()` antes do hash |
| Hashear telefone sem normalizar para E.164 | Hash incompatível com o formato que a Meta usa | Normalizar para E.164 antes de hashear |
| Hashear `fbp` ou `fbc` | Meta não consegue fazer match de cliques | `fbp` e `fbc` são enviados brutos, nunca hasheados |
| Não hashear email (enviar em texto claro) | Viola política Meta e pode suspender o pixel | Email sempre hasheado |
| Hashear `client_ip_address` | IP hasheado é inútil para a Meta | IP sempre bruto |
| Enviar hash com letras maiúsculas (`A-F` em vez de `a-f`) | Hash inválido | Usar `.digest('hex')` no Node ou `.toString(16)` no browser — ambos retornam lowercase |
| Omitir campos opcionais quando disponíveis | EMQ menor que o possível | Envie tudo que tiver: quanto mais campos de matching, maior o EMQ |
| Telefone com "+" no Meta (ou sem "+" no Google) | O telefone para de casar, sem erro | Uma função de normalização por plataforma |
| `external_id` com hash num canal e cru no outro | Os dois valores não batem | Mesmo tratamento no navegador e no servidor |

---

## 7. Email para o Google

O Google pede a mesma base (trim + minúsculas) e uma regra a mais: em endereços `gmail.com` e `googlemail.com`, remova os pontos antes do `@`.

```typescript
function normalizeEmailGoogle(email: string): string {
  const e = email.trim().toLowerCase();
  const [local, domain] = e.split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${local.replace(/\./g, '')}@${domain}`;
  }
  return e;
}
```

O hash vai em hexadecimal minúsculo, como no Meta. `scripts/enviar-venda-crm.ts` já aplica as duas regras.
