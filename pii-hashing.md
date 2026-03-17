# PII Hashing — Tratamento de Dados Pessoais para Rastreamento

Guia completo sobre como tratar dados pessoais (PII) antes de enviá-los ao Meta Pixel e à Conversions API.

---

## 1. Por que hashear PII

Meta e Google exigem que dados pessoais sejam hasheados com SHA-256 antes de serem enviados via pixel browser ou CAPI. Os motivos são:

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

### Por que E.164

E.164 é o formato internacional padrão de telefone: `+[código do país][número]`, sem espaços, parênteses ou hífens. A Meta usa esse formato para matching. Se você enviar `(11) 99999-8888` hasheado, a Meta não vai conseguir fazer match porque o hash será diferente do hash que ela tem para `5511999998888`.

### Regras para Brasil

- Remove todos os caracteres não-dígitos
- Se o resultado tiver 10 ou 11 dígitos: adiciona o prefixo `55` (código do Brasil)
- Se já começar com `55` e tiver 12 ou 13 dígitos: assume que já está correto
- O sinal `+` é opcional para a CAPI — a Meta aceita com ou sem

### Exemplos

| Input | Após normalização E.164 |
|---|---|
| `(11) 99999-8888` | `5511999998888` |
| `11 9 9999-8888` | `5511999998888` |
| `+55 11 99999-8888` | `5511999998888` |
| `5511999998888` | `5511999998888` (já correto) |
| `99999-8888` | não normalizar — 9 dígitos é inválido para CAPI |

### Código TypeScript (backend)

```typescript
function normalizePhoneBR(raw: string): string | null {
  // Remove tudo que não for dígito
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 10 || digits.length === 11) {
    // Número local BR sem código de país
    return `55${digits}`;
  }

  if (digits.length === 12 || digits.length === 13) {
    // Provavelmente já tem o código 55
    if (digits.startsWith('55')) {
      return digits;
    }
  }

  // Não foi possível normalizar de forma segura
  return null;
}
```

### Código JavaScript (browser)

```javascript
function normalizePhoneBR(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits;
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
