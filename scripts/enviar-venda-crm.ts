/**
 * enviar-venda-crm.ts
 *
 * Pega uma venda que fechou no CRM e manda a conversão para o Meta (CAPI)
 * e para o Google Ads (Data Manager API), usando a origem que o lead trouxe
 * quando entrou (ver scripts/captura-origem.js e crm-utms-e-vendas.md).
 *
 * Quem acha a campanha certa:
 *   - Meta: o user_data. Principalmente o fbc (fb.1.{ms}.{fbclid}), depois
 *     telefone e email com hash. A Meta liga a venda ao clique por eles.
 *   - Google: o gclid (ou gbraid/wbraid) e o email/telefone com hash.
 * As UTMs com os IDs de campanha vão junto em custom_data no Meta, para relatório
 * e conversão personalizada, mas NÃO são o que atribui. Sem fbc/gclid/telefone/
 * email, a venda chega sem campanha, mesmo com a UTM certa.
 *
 * Uso como CLI (uma venda ou uma lista):
 *   npx tsx scripts/enviar-venda-crm.ts venda.json
 *
 * Uso no backend (webhook do CRM quando a negociação vira "ganha"):
 *   import { enviarVenda } from './enviar-venda-crm'
 *   await enviarVenda(vendaMontadaAPartirDoCRM)
 *
 * Variáveis de ambiente:
 *   Meta (ver backend-capi.ts): META_CAPI_PIXEL_ID, META_CAPI_ACCESS_TOKEN,
 *     META_CAPI_TEST_CODE (só em teste)
 *   Google (opcionais; sem elas o envio ao Google é pulado):
 *     GOOGLE_ADS_CUSTOMER_ID         : conta do Google Ads, só dígitos (ex: 1234567890)
 *     GOOGLE_ADS_LOGIN_CUSTOMER_ID   : MCC, se o acesso for por uma
 *     GOOGLE_ADS_CONVERSION_ACTION_ID: ação de conversão do tipo
 *                                       "Importar de cliques" (UPLOAD_CLICKS)
 *     GOOGLE_DATAMANAGER_VALIDATE_ONLY=true: valida sem gravar (use no primeiro teste)
 *     Credencial: Application Default Credentials com o escopo
 *     https://www.googleapis.com/auth/datamanager (ver crm-utms-e-vendas.md)
 *
 * Dependência só para o Google: npm i google-auth-library
 */

import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { normalizePhone, sendPurchase, type ActionSource } from './backend-capi'

// ---------------------------------------------------------------------------
// O formato da venda que sai do CRM
// ---------------------------------------------------------------------------

/**
 * Origem gravada no lead quando ele entrou (os campos ocultos do formulário
 * ou o que o backend salvou). Os nomes são os de captura-origem.js.
 */
export interface OrigemLead {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string // recomendado: ID da campanha ({{campaign.id}} / {campaignid})
  utm_content?: string  // recomendado: ID do anúncio ({{ad.id}} / {creative})
  utm_term?: string     // recomendado: ID do conjunto ({{adset.id}}) ou palavra-chave
  utm_id?: string
  fbclid?: string
  fbc?: string          // fb.1.{ms}.{fbclid}, preferido ao fbclid cru
  fbp?: string
  gclid?: string
  gbraid?: string
  wbraid?: string
  origem_capturada_em?: string // ISO 8601: quando o clique foi capturado
  client_user_agent?: string
  client_ip_address?: string
  /** ID do lead quando ele veio de formulário instantâneo do Meta (Lead Ads) */
  meta_lead_id?: string
  /** O lead aceitou uso dos dados para anúncios (LGPD / consentimento do Google) */
  consentimento?: boolean
}

export interface VendaCRM {
  /** ID da venda/negociação no CRM. Vira o event_id no Meta e o transactionId no Google. */
  idVenda: string
  valor: number
  moeda?: string
  /** Quando a venda fechou (ISO 8601 com fuso, ex: "2026-10-29T14:30:00-03:00") */
  fechadaEm: string
  /**
   * Onde a venda fechou: chat (WhatsApp/direct), phone_call, physical_store,
   * website, other. Ver crm-utms-e-vendas.md.
   */
  canal: ActionSource
  produtos?: { id: string; preco?: number; quantidade?: number }[]
  contato: {
    /** ID do contato no CRM. Vai como external_id com hash. */
    id: string
    email?: string
    telefone?: string
    nome?: string
    sobrenome?: string
    cidade?: string
    uf?: string
  }
  origem: OrigemLead
}

export interface ResultadoEnvio {
  idVenda: string
  meta: 'enviado' | 'pulado' | string
  google: 'enviado' | 'validado' | 'pulado' | string
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

/** fbc salvo, ou montado a partir do fbclid com a hora em que o clique foi capturado. */
function fbcDaOrigem(origem: OrigemLead): string | undefined {
  if (origem.fbc) return origem.fbc
  if (!origem.fbclid) return undefined
  const capturadoMs = origem.origem_capturada_em ? Date.parse(origem.origem_capturada_em) : NaN
  // Sem a hora do clique, a doc da Meta manda usar a primeira vez que o fbclid foi visto
  const ms = Number.isNaN(capturadoMs) ? Date.now() : capturadoMs
  return `fb.1.${ms}.${origem.fbclid}` // fbclid exatamente como veio
}

/** UTMs que vão em custom_data. Só relatório: não atribuem. */
function utmsParaCustomData(origem: OrigemLead): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id'] as const) {
    if (origem[k]) out[k] = origem[k] as string
  }
  return out
}

export async function enviarVendaMeta(venda: VendaCRM): Promise<void> {
  const fechadaEm = Date.parse(venda.fechadaEm)
  if (Number.isNaN(fechadaEm)) throw new Error(`[Meta] fechadaEm inválido na venda ${venda.idVenda}`)

  await sendPurchase({
    // ID determinístico: reenviar a mesma venda em até 48 h não duplica
    eventId: `purchase_${venda.idVenda}`,
    eventTime: Math.floor(fechadaEm / 1000),
    actionSource: venda.canal,
    user: {
      email: venda.contato.email,
      phone: venda.contato.telefone,
      firstName: venda.contato.nome,
      lastName: venda.contato.sobrenome,
      city: venda.contato.cidade,
      state: venda.contato.uf,
      country: 'br',
      externalId: venda.contato.id,
    },
    context: {
      fbc: fbcDaOrigem(venda.origem),
      fbp: venda.origem.fbp,
      ipAddress: venda.origem.client_ip_address,
      userAgent: venda.origem.client_user_agent,
      leadId: venda.origem.meta_lead_id,
    },
    products: (venda.produtos ?? []).map(p => ({ id: p.id, price: p.preco, quantity: p.quantidade })),
    value: venda.valor,
    currency: venda.moeda ?? 'BRL',
    orderId: venda.idVenda,
    extraCustomData: utmsParaCustomData(venda.origem),
  })
}

// ---------------------------------------------------------------------------
// Google Ads (Data Manager API)
// ---------------------------------------------------------------------------

const DATA_MANAGER_URL = 'https://datamanager.googleapis.com/v1/events:ingest'
const DATA_MANAGER_SCOPE = 'https://www.googleapis.com/auth/datamanager'

function sha256Hex(valor: string): string {
  return crypto.createHash('sha256').update(valor).digest('hex')
}

/**
 * Email no formato do Google antes do hash: trim + minúsculas, e para
 * gmail.com/googlemail.com sem os pontos antes do @.
 */
function emailGoogle(email: string): string {
  const e = email.trim().toLowerCase()
  const [local, dominio] = e.split('@')
  if (dominio === 'gmail.com' || dominio === 'googlemail.com') {
    return `${local.replace(/\./g, '')}@${dominio}`
  }
  return e
}

/** Telefone no formato do Google antes do hash: E.164 COM o "+" (diferente da Meta). */
function telefoneGoogle(telefone: string): string {
  return `+${normalizePhone(telefone)}`
}

async function tokenGoogle(): Promise<string> {
  // Import dinâmico: quem só usa Meta não precisa instalar a lib
  const { GoogleAuth } = await import('google-auth-library')
  const auth = new GoogleAuth({ scopes: [DATA_MANAGER_SCOPE] })
  const token = await auth.getAccessToken()
  if (!token) throw new Error('[Google] Não consegui token. Configure as Application Default Credentials.')
  return token
}

export async function enviarVendaGoogle(venda: VendaCRM): Promise<'enviado' | 'validado' | 'pulado'> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID
  const conversionActionId = process.env.GOOGLE_ADS_CONVERSION_ACTION_ID
  if (!customerId || !conversionActionId) return 'pulado'

  const { gclid, gbraid, wbraid } = venda.origem
  const identificadores: Record<string, string>[] = []
  if (venda.contato.email) identificadores.push({ emailAddress: sha256Hex(emailGoogle(venda.contato.email)) })
  if (venda.contato.telefone) identificadores.push({ phoneNumber: sha256Hex(telefoneGoogle(venda.contato.telefone)) })

  // Sem clique e sem dado do contato o Google não tem como achar a campanha
  if (!gclid && !gbraid && !wbraid && identificadores.length === 0) return 'pulado'

  // Um identificador de clique só: gclid tem prioridade
  const adIdentifiers = gclid ? { gclid } : gbraid ? { gbraid } : wbraid ? { wbraid } : undefined

  const destino: Record<string, unknown> = {
    operatingAccount: { accountType: 'GOOGLE_ADS', accountId: customerId },
    productDestinationId: conversionActionId,
  }
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    destino.loginAccount = { accountType: 'GOOGLE_ADS', accountId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID }
  }

  const consentido = venda.origem.consentimento !== false
  const validateOnly = process.env.GOOGLE_DATAMANAGER_VALIDATE_ONLY === 'true'

  const corpo = {
    destinations: [destino],
    encoding: 'HEX',
    consent: {
      adUserData: consentido ? 'CONSENT_GRANTED' : 'CONSENT_DENIED',
      adPersonalization: consentido ? 'CONSENT_GRANTED' : 'CONSENT_DENIED',
    },
    events: [{
      ...(adIdentifiers && { adIdentifiers }),
      conversionValue: venda.valor,
      currency: venda.moeda ?? 'BRL',
      eventTimestamp: venda.fechadaEm, // ISO 8601 com fuso
      transactionId: venda.idVenda,    // o Google deduplica por ele
      eventSource: 'WEB',              // o clique foi num anúncio que levou ao site
      ...(identificadores.length > 0 && { userData: { userIdentifiers: identificadores } }),
    }],
    validateOnly,
  }

  const resposta = await fetch(DATA_MANAGER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await tokenGoogle()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(15_000),
  })

  const dados = await resposta.json().catch(() => ({})) as Record<string, unknown>
  if (!resposta.ok) {
    const erro = dados.error as Record<string, unknown> | undefined
    throw new Error(`[Google] ${resposta.status}: ${erro?.message ?? JSON.stringify(dados)}`)
  }

  // O processamento é assíncrono: o requestId serve para consultar o status depois
  console.log('[Google] aceito:', { idVenda: venda.idVenda, requestId: dados.requestId, validateOnly })
  return validateOnly ? 'validado' : 'enviado'
}

// ---------------------------------------------------------------------------
// Os dois juntos
// ---------------------------------------------------------------------------

/**
 * Manda a venda para o Meta e para o Google. Um não trava o outro: se um falha,
 * o erro volta no resultado e o outro segue.
 *
 * Grave no CRM que a venda foi enviada. A Meta só deduplica o mesmo event_id
 * por 48 h: reenviar depois disso conta de novo.
 */
export async function enviarVenda(venda: VendaCRM): Promise<ResultadoEnvio> {
  const [meta, google] = await Promise.allSettled([enviarVendaMeta(venda), enviarVendaGoogle(venda)])
  return {
    idVenda: venda.idVenda,
    meta: meta.status === 'fulfilled' ? 'enviado' : String(meta.reason?.message ?? meta.reason),
    google: google.status === 'fulfilled' ? google.value : String(google.reason?.message ?? google.reason),
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(arquivo: string): Promise<void> {
  const conteudo = JSON.parse(readFileSync(arquivo, 'utf-8')) as VendaCRM | VendaCRM[]
  const vendas = Array.isArray(conteudo) ? conteudo : [conteudo]
  for (const venda of vendas) {
    console.log(JSON.stringify(await enviarVenda(venda)))
  }
}

// Roda como CLI só quando chamado direto (não quando importado pelo backend)
const arquivo = process.argv[2]
if (arquivo && process.argv[1]?.endsWith('enviar-venda-crm.ts')) {
  main(arquivo).catch(err => {
    console.error(err)
    process.exit(1)
  })
}
