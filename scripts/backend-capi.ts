/**
 * Meta Conversions API (CAPI) — Servico server-side
 *
 * Envia eventos de conversao para a Meta Graph API (padrao v26.0)
 * sem depender do pixel browser. Funciona mesmo com ad blockers ativos.
 *
 * Variaveis de ambiente:
 *   META_CAPI_PIXEL_ID       — ID numerico do pixel (ex: 123456789012345)
 *   META_CAPI_ACCESS_TOKEN   — token gerado no Events Manager (Configuracoes do
 *                              pixel > Conversions API > Gerar token) ou de um
 *                              System User com acesso ao pixel
 *   META_CAPI_TEST_CODE      — Codigo de teste (deixar VAZIO em producao!)
 *   META_GRAPH_API_VERSION   — opcional, padrao "v26.0". Cada versao vive cerca de
 *                              2 anos: https://developers.facebook.com/docs/graph-api/changelog/versions
 *
 * Seguranca e PII:
 *   - Dados pessoais (email, telefone, nome) sao hasheados SHA-256 ANTES do envio
 *   - NUNCA logar email, telefone, nome, CPF, IP em texto claro nos logs
 *   - NUNCA commitar .env ou o access token em qualquer arquivo
 *   - O access token deve aparecer APENAS na variavel de ambiente
 */

import crypto from 'node:crypto'

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION ?? 'v26.0'

/** A Meta recusa a requisicao inteira se algum event_time tiver mais de 7 dias. */
const MAX_EVENT_AGE_SECONDS = 7 * 24 * 60 * 60

/**
 * Onde a conversao aconteceu. Valores aceitos pela Meta:
 * https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/server-event
 * Venda fechada no CRM: use o canal real do fechamento (chat, phone_call,
 * physical_store, other). Ver crm-utms-e-vendas.md.
 */
export type ActionSource =
  | 'website'
  | 'app'
  | 'email'
  | 'phone_call'
  | 'chat'
  | 'physical_store'
  | 'system_generated'
  | 'business_messaging'
  | 'other'

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Contexto CAPI capturado no momento do checkout (nao no webhook).
 * Deve ser salvo no banco de dados junto com o pedido para ser recuperado
 * quando o webhook de confirmacao chegar (horas ou dias depois).
 *
 * Campos coletados pelo FRONTEND e enviados ao backend:
 *   - capiEventId: UUID unico gerado pelo frontend para deduplicacao com o pixel
 *   - fbp: cookie _fbp do browser (identificador do browser do usuario)
 *   - fbc: cookie _fbc ou parametro fbclid da URL (click ID do anuncio)
 *
 * Campos coletados pelo BACKEND (via req.headers):
 *   - ipAddress: IP real do cliente (X-Forwarded-For ou req.socket.remoteAddress)
 *   - userAgent: User-Agent do browser do cliente
 */
export interface CAPIContext {
  /** UUID gerado pelo frontend (crypto.randomUUID()) — usado para deduplicacao */
  capiEventId?: string
  /** Cookie _fbp do browser — identifica o browser do usuario para a Meta */
  fbp?: string
  /**
   * Click ID do anuncio no formato fb.1.{timestamp_ms}.{fbclid}.
   * Vem do cookie _fbc ou e montado a partir do fbclid da URL (ver captura-origem.js).
   * NUNCA mandar o fbclid cru aqui e nunca mudar maiusculas/minusculas.
   */
  fbc?: string
  /** IP real do cliente — NAO enviar IP do servidor */
  ipAddress?: string
  /** User-Agent completo do browser do cliente */
  userAgent?: string
  /**
   * ID do lead quando ele veio de formulario instantaneo do Meta (Lead Ads).
   * Vai sem hash em user_data.lead_id.
   */
  leadId?: string
}

/**
 * Dados do usuario para construcao do user_data.
 * Todos os campos de PII sao opcionais — quanto mais campos fornecidos,
 * maior o Event Match Quality (EMQ) e melhor a atribuicao de conversoes.
 */
export interface UserCAPIData {
  /** Email do usuario — sera hasheado SHA-256 apos trim()+toLowerCase() */
  email?: string
  /**
   * Telefone do usuario — sera normalizado para E.164 e depois hasheado.
   * Aceita formatos: "11999999999", "(11) 99999-9999", "+5511999999999"
   */
  phone?: string
  /** Primeiro nome — sera hasheado apos trim()+toLowerCase() */
  firstName?: string
  /** Ultimo nome — sera hasheado apos trim()+toLowerCase() */
  lastName?: string
  /**
   * ID interno do usuario no seu sistema (userId do banco).
   * Sera hasheado SHA-256 apos toString()+trim()+toLowerCase().
   * Ajuda no matching cross-device.
   */
  externalId?: string
  /** Cidade — sera hasheada apos trim()+toLowerCase() */
  city?: string
  /** Estado/UF (2 letras) — sera hasheado apos trim()+toLowerCase() */
  state?: string
  /** Codigo postal — apenas digitos antes do hash */
  zipCode?: string
  /** Codigo do pais em ISO 3166-1 alpha-2 lowercase (ex: "br") */
  country?: string
}

/**
 * Produto ou conteudo associado ao evento de conversao.
 * Usado em Purchase, ViewContent, InitiateCheckout.
 */
export interface CAPIProduct {
  /** ID do produto no seu catalogo (ex: "produto-exemplo", "curso-exemplo") */
  id: string
  /** Nome do produto (ex: "Produto Exemplo") */
  name?: string
  /** Preco unitario em BRL */
  price?: number
  /** Quantidade — padrao 1 */
  quantity?: number
  /** Categoria do produto */
  category?: string
}

// ---------------------------------------------------------------------------
// Utilitarios internos
// ---------------------------------------------------------------------------

/**
 * Cria um hash SHA-256 de uma string.
 * Usado para proteger dados PII antes de enviar para a Meta.
 *
 * IMPORTANTE: o valor de entrada ja deve estar normalizado
 * (trim() + toLowerCase()) antes de chamar esta funcao.
 *
 * Log seguro: voce pode logar o hash (nunca o valor original).
 */
function hashField(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

/**
 * Normaliza um telefone para o formato que a META espera antes do hash:
 * so digitos, com DDI, SEM o sinal de + (ex: "5511999999999").
 *
 * Atencao: o Google (Data Manager API) quer o E.164 COM o "+" antes do hash.
 * O mesmo telefone gera hashes diferentes para cada plataforma. Ver pii-hashing.md.
 *
 * Formatos aceitos:
 *   - "11999999999"        → "5511999999999"
 *   - "(11) 99999-9999"    → "5511999999999"
 *   - "+55 11 99999-9999"  → "5511999999999"
 *   - "55 11 99999-9999"   → "5511999999999"
 *   - "011999999999"       → "5511999999999"
 *   - "(55) 99999-9999"    → "5555999999999"  (DDD 55, RS)
 *   - "+1 415 555 2671"    → "14155552671"    (com "+", o DDI informado e respeitado)
 */
export function normalizePhone(phone: string): string {
  const hadPlus = phone.trim().startsWith('+')
  let digits = phone.replace(/\D/g, '')

  // Veio com "+": o DDI ja esta no numero, qualquer pais
  if (hadPlus) return digits

  // Ja tem DDI do Brasil (55 + DDD + numero = 12 ou 13 digitos)
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits
  }

  // Remove o 0 de discagem de longa distancia (ex: "011999999999" → "11999999999")
  if (digits.startsWith('0')) {
    digits = digits.slice(1)
  }

  // Numero brasileiro sem DDI
  return '55' + digits
}

/**
 * Monta o objeto user_data seguindo as regras da Meta CAPI:
 * - Campos PII hasheados com SHA-256 (apos normalizacao)
 * - Campos de identificacao tecnica (fbp, fbc, ip, ua) enviados em texto claro
 * - Campos ausentes/undefined sao omitidos automaticamente
 *
 * Referencia: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
 */
function buildUserData(
  user: UserCAPIData,
  context: CAPIContext,
): Record<string, string | undefined> {
  const userData: Record<string, string | undefined> = {}

  // --- Campos que devem ser hasheados ---

  if (user.email) {
    // Normalizar: trim() + toLowerCase() antes do hash
    userData.em = hashField(user.email.trim().toLowerCase())
  }

  if (user.phone) {
    // Normalizar para E.164 (sem o +) antes do hash
    const normalizedPhone = normalizePhone(user.phone)
    userData.ph = hashField(normalizedPhone)
  }

  if (user.firstName) {
    userData.fn = hashField(user.firstName.trim().toLowerCase())
  }

  if (user.lastName) {
    userData.ln = hashField(user.lastName.trim().toLowerCase())
  }

  if (user.externalId) {
    // ID interno do sistema — hashear para proteger
    userData.external_id = hashField(String(user.externalId).trim().toLowerCase())
  }

  if (user.city) {
    userData.ct = hashField(user.city.trim().toLowerCase())
  }

  if (user.state) {
    // Estado deve ser 2 letras lowercase (ex: "sp", "rj")
    userData.st = hashField(user.state.trim().toLowerCase())
  }

  if (user.zipCode) {
    // CEP: apenas digitos antes do hash
    const digits = user.zipCode.replace(/\D/g, '')
    userData.zp = hashField(digits)
  }

  if (user.country) {
    // Pais: codigo ISO 3166-1 alpha-2 lowercase (ex: "br")
    userData.country = hashField(user.country.trim().toLowerCase())
  }

  // --- Campos que NAO devem ser hasheados ---
  // Estes sao identificadores tecnicos, nao PII direta

  if (context.fbp) {
    // Cookie _fbp: identificador do browser gerado pelo pixel da Meta
    // Formato: fb.1.{timestamp}.{random}
    userData.fbp = context.fbp
  }

  if (context.fbc) {
    // Cookie _fbc ou parametro fbclid da URL: identifica o clique no anuncio
    // Formato: fb.1.{timestamp}.{fbclid}
    userData.fbc = context.fbc
  }

  if (context.ipAddress) {
    // IP REAL do cliente — nao enviar IP interno do servidor (127.0.0.1, 10.x.x.x)
    // Capturar via: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress
    userData.client_ip_address = context.ipAddress
  }

  if (context.userAgent) {
    // User-Agent do browser do cliente (req.headers['user-agent'])
    userData.client_user_agent = context.userAgent
  }

  if (context.leadId) {
    // Lead Ads: o ID do lead liga a venda ao formulario instantaneo, sem hash
    userData.lead_id = context.leadId
  }

  // Remove campos undefined para nao enviar chaves nulas no payload
  return Object.fromEntries(
    Object.entries(userData).filter(([, v]) => v !== undefined)
  )
}

// ---------------------------------------------------------------------------
// Funcao interna de envio
// ---------------------------------------------------------------------------

interface CAPIEventPayload {
  eventName: string
  /** event_id para deduplicacao com o pixel browser — usar capiEventId do banco */
  eventId?: string
  /**
   * Quando o evento aconteceu (Unix em SEGUNDOS). Padrao: agora.
   * Para venda confirmada depois (webhook, CRM), mande a hora real da venda.
   */
  eventTime?: number
  /** Padrao: 'website'. Para venda fechada fora do site, ver ActionSource. */
  actionSource?: ActionSource
  /** URL da pagina onde ocorreu o evento */
  eventSourceUrl?: string
  user: UserCAPIData
  context: CAPIContext
  customData?: Record<string, unknown>
}

/**
 * Funcao interna que envia um evento para a Meta CAPI via Graph API.
 *
 * NAO use esta funcao diretamente nas rotas — use as funcoes publicas
 * exportadas (sendPurchase, sendInitiateCheckout, etc.) que fornecem
 * tipagem especifica e validacao dos dados obrigatorios.
 *
 * Erros:
 * - Lanca excecao em caso de erro de rede ou resposta de erro da Meta
 * - Use `.catch()` no chamador para nao bloquear a resposta HTTP
 *
 * O que logar (seguro):
 * - event_id (UUID opaco)
 * - event_name
 * - resposta de sucesso da API (event_id retornado)
 * - mensagem de erro (sem dados do usuario)
 *
 * O que NAO logar:
 * - email, telefone, nome, CPF em texto claro
 * - access token
 * - fbp, fbc (identificadores de usuario)
 */
async function sendCAPIEvent(payload: CAPIEventPayload): Promise<void> {
  const pixelId = process.env.META_CAPI_PIXEL_ID
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN

  if (!pixelId || !accessToken) {
    // Em desenvolvimento pode ser aceitavel pular o envio — em producao e um erro grave
    console.warn('[CAPI] META_CAPI_PIXEL_ID ou META_CAPI_ACCESS_TOKEN nao configurados — evento ignorado:', payload.eventName)
    return
  }

  const now = Math.floor(Date.now() / 1000) // Unix timestamp em segundos
  const eventTime = payload.eventTime ?? now

  if (now - eventTime > MAX_EVENT_AGE_SECONDS) {
    // A Meta derrubaria a requisicao inteira. Melhor falhar aqui com mensagem clara.
    throw new Error(`[CAPI] ${payload.eventName} com event_time de mais de 7 dias — a Meta recusa. Envie as vendas com mais frequencia.`)
  }

  const actionSource = payload.actionSource ?? 'website'
  const userData = buildUserData(payload.user, payload.context)

  if (actionSource === 'website' && !userData.client_user_agent) {
    // Para action_source=website a Meta exige client_user_agent
    console.warn('[CAPI] action_source=website sem client_user_agent — a Meta pode rejeitar:', payload.eventName)
  }

  const eventData: Record<string, unknown> = {
    event_name: payload.eventName,
    event_time: eventTime,
    action_source: actionSource,
    user_data: userData,
  }

  // event_id: a Meta deduplica quando event_name E event_id batem (janela de 48 h).
  // Se nao vier, gera um UUID: o evento chega, mas sem deduplicacao.
  const eventId = payload.eventId ?? payload.context.capiEventId ?? crypto.randomUUID()
  eventData.event_id = eventId

  // URL da pagina onde o evento ocorreu (ajuda no EMQ e no contexto)
  if (payload.eventSourceUrl) {
    eventData.event_source_url = payload.eventSourceUrl
  }

  // Dados customizados do evento (valor, moeda, produtos, etc.)
  if (payload.customData && Object.keys(payload.customData).length > 0) {
    eventData.custom_data = payload.customData
  }

  // Montar o payload final
  const body: Record<string, unknown> = {
    data: [eventData],
  }

  // Adicionar test_event_code APENAS se definido (remover em producao!)
  // ATENCAO: eventos com test_event_code NAO sao descartados. Aparecem em Test Events
  // e tambem entram nos dados do pixel (segmentacao e mensuracao).
  const testCode = process.env.META_CAPI_TEST_CODE
  if (testCode && testCode.trim() !== '') {
    body.test_event_code = testCode.trim()
    // Em producao: se este log aparecer, a variavel de ambiente esta errada
    console.warn('[CAPI] ATENCAO: enviando para Test Events (nao producao). Limpe META_CAPI_TEST_CODE para producao.')
  }

  // O token vai na query string: nunca logue esta URL
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${accessToken}`

  // Log seguro — sem PII, sem access token
  console.log('[CAPI] Enviando evento:', {
    eventName: payload.eventName,
    eventId,
    // Logar apenas a presenca dos campos, nunca os valores
    hasEmail: !!payload.user.email,
    hasPhone: !!payload.user.phone,
    hasFbp: !!payload.context.fbp,
    hasFbc: !!payload.context.fbc,
    hasIp: !!payload.context.ipAddress,
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // Sem timeout, uma Meta lenta segura a conexao indefinidamente
    signal: AbortSignal.timeout(10_000),
  })

  const responseData = await response.json().catch(() => ({})) as Record<string, unknown>

  // Erros da Graph API voltam com status 4xx e um objeto "error" (ex: code 190 = token invalido)
  if (!response.ok || responseData.error) {
    const errorInfo = responseData.error as Record<string, unknown> | undefined
    throw new Error(
      `[CAPI] Erro da API: ${response.status} — ${errorInfo?.message ?? JSON.stringify(responseData)}`
    )
  }

  console.log('[CAPI] Evento enviado com sucesso:', {
    eventName: payload.eventName,
    eventId,
    // events_received e retornado pela Meta em responses bem-sucedidas
    eventsReceived: responseData.events_received,
  })
}

// ---------------------------------------------------------------------------
// Funcoes publicas exportadas
// ---------------------------------------------------------------------------

/**
 * Envia evento Lead: disparar quando o formulario de contato chega ao backend
 * (antes de criar o lead no CRM).
 *
 * Equivalente GTM/pixel: fbq('track', 'Lead', {}, { eventID: 'lead_' + idLead })
 *
 * event_id: use `lead_{idLead}` dos dois lados. O navegador recebe o idLead na
 * resposta do POST e dispara o pixel com o mesmo ID.
 *
 * Fire-and-forget recomendado:
 *   sendLead(...).catch(err => console.error('[CAPI] Lead:', err))
 */
export async function sendLead(options: {
  /** ID do lead no seu sistema ou no CRM */
  leadId: string
  user: UserCAPIData
  context: CAPIContext
  /** URL da pagina do formulario */
  eventSourceUrl?: string
  /** Valor estimado do lead (opcional) */
  value?: number
  currency?: string
}): Promise<void> {
  const customData: Record<string, unknown> = {}
  if (options.value !== undefined) {
    customData.value = options.value
    customData.currency = options.currency ?? 'BRL'
  }

  return sendCAPIEvent({
    eventName: 'Lead',
    eventId: `lead_${options.leadId}`,
    context: options.context,
    user: options.user,
    eventSourceUrl: options.eventSourceUrl,
    customData: Object.keys(customData).length > 0 ? customData : undefined,
  })
}

/**
 * Envia evento CompleteRegistration — disparar quando o usuario cria conta
 * ou completa um cadastro.
 *
 * Equivalente GTM/pixel: fbq('track', 'CompleteRegistration', { currency: 'BRL' })
 *
 * Quando disparar:
 * - Apos salvar o usuario no banco com sucesso
 * - Incluir no handler de criacao de conta (nao no login)
 *
 * Fire-and-forget recomendado:
 *   sendCompleteRegistration(...).catch(err => console.error('[CAPI] Registration:', err))
 *   res.json({ success: true }) // nao aguardar CAPI
 */
export async function sendCompleteRegistration(options: {
  user: UserCAPIData
  context: CAPIContext
  /** URL da pagina de registro */
  eventSourceUrl?: string
  /** Status da conversao (ex: "completed", "registered") */
  status?: string
}): Promise<void> {
  const customData: Record<string, unknown> = {}

  if (options.status) {
    customData.status = options.status
  }

  return sendCAPIEvent({
    eventName: 'CompleteRegistration',
    context: options.context,
    user: options.user,
    eventSourceUrl: options.eventSourceUrl,
    customData: Object.keys(customData).length > 0 ? customData : undefined,
  })
}

/**
 * Envia evento ViewContent — disparar quando o usuario visualiza uma pagina
 * de produto ou conteudo relevante.
 *
 * Equivalente GTM/pixel: fbq('track', 'ViewContent', { content_ids: [...] })
 *
 * Quando disparar:
 * - Ao abrir a pagina de detalhes de um produto
 * - Ao abrir a pagina de vendas (landing page do produto)
 *
 * Nota: ViewContent via CAPI tem pouco impacto em EMQ — priorizamos
 * InitiateCheckout e Purchase no server-side.
 */
export async function sendViewContent(options: {
  user: UserCAPIData
  context: CAPIContext
  products: CAPIProduct[]
  /** URL da pagina visualizada */
  eventSourceUrl?: string
  /** Valor total do conteudo (usado em retargeting de abandono) */
  value?: number
  /** Moeda — padrao "BRL" */
  currency?: string
}): Promise<void> {
  const customData: Record<string, unknown> = {
    content_ids: options.products.map(p => p.id),
    content_type: 'product',
    currency: options.currency ?? 'BRL',
  }

  if (options.value !== undefined) {
    customData.value = options.value
  }

  if (options.products.length > 0) {
    customData.contents = options.products.map(p => ({
      id: p.id,
      quantity: p.quantity ?? 1,
      item_price: p.price,
    }))
  }

  return sendCAPIEvent({
    eventName: 'ViewContent',
    context: options.context,
    user: options.user,
    eventSourceUrl: options.eventSourceUrl,
    customData,
  })
}

/**
 * Envia evento InitiateCheckout — disparar quando o usuario abre o formulario
 * de checkout (antes de preencher pagamento).
 *
 * Equivalente GTM/pixel: fbq('track', 'InitiateCheckout', { ... })
 *
 * Quando disparar:
 * - Ao renderizar o modal/pagina de checkout
 * - ANTES de capturar dados de pagamento
 *
 * Este e um bom ponto para salvar o capiContext inicial no banco,
 * mesmo que o pagamento ainda nao tenha sido criado.
 */
export async function sendInitiateCheckout(options: {
  user: UserCAPIData
  context: CAPIContext
  products: CAPIProduct[]
  /** Valor total do carrinho */
  value: number
  /** Moeda — padrao "BRL" */
  currency?: string
  /** Numero de itens no carrinho */
  numItems?: number
  /** URL da pagina de checkout */
  eventSourceUrl?: string
}): Promise<void> {
  const customData: Record<string, unknown> = {
    value: options.value,
    currency: options.currency ?? 'BRL',
    content_ids: options.products.map(p => p.id),
    content_type: 'product',
    num_items: options.numItems ?? options.products.reduce((acc, p) => acc + (p.quantity ?? 1), 0),
  }

  if (options.products.length > 0) {
    customData.contents = options.products.map(p => ({
      id: p.id,
      quantity: p.quantity ?? 1,
      item_price: p.price,
    }))
  }

  return sendCAPIEvent({
    eventName: 'InitiateCheckout',
    context: options.context,
    user: options.user,
    eventSourceUrl: options.eventSourceUrl,
    customData,
  })
}

/**
 * Envia evento AddPaymentInfo — disparar quando o usuario insere ou seleciona
 * o metodo de pagamento no checkout.
 *
 * Equivalente GTM/pixel: fbq('track', 'AddPaymentInfo', { ... })
 *
 * Quando disparar:
 * - Quando o usuario clica em "Pagar com PIX" ou "Pagar com Cartao"
 * - Apos validar os dados do formulario de pagamento
 * - ANTES de criar o pagamento no gateway
 */
export async function sendAddPaymentInfo(options: {
  user: UserCAPIData
  context: CAPIContext
  products: CAPIProduct[]
  /** Valor total */
  value: number
  /** Moeda — padrao "BRL" */
  currency?: string
  /** Metodo de pagamento selecionado (ex: "PIX", "CREDIT_CARD") */
  paymentMethod?: string
  /** URL da pagina de checkout */
  eventSourceUrl?: string
}): Promise<void> {
  const customData: Record<string, unknown> = {
    value: options.value,
    currency: options.currency ?? 'BRL',
    content_ids: options.products.map(p => p.id),
    content_type: 'product',
  }

  if (options.paymentMethod) {
    // Nao e um campo oficial da Meta, mas e util para filtragem interna
    // Usar com cautela — pode ser ignorado pelo algoritmo
    customData.payment_method = options.paymentMethod
  }

  return sendCAPIEvent({
    eventName: 'AddPaymentInfo',
    context: options.context,
    user: options.user,
    eventSourceUrl: options.eventSourceUrl,
    customData,
  })
}

/**
 * Envia evento Purchase — o evento mais importante para otimizacao de campanhas.
 *
 * Equivalente GTM/pixel: fbq('track', 'Purchase', { value: 197.00, currency: 'BRL' })
 *
 * Quando disparar:
 * - NO WEBHOOK de confirmacao de pagamento (Asaas, Stripe, Mercado Pago etc.)
 * - Quando a venda for marcada no CRM (ver scripts/enviar-venda-crm.ts)
 * - Usar o capiEventId salvo no banco (mesmo ID do pixel browser = deduplicacao)
 * - NAO gerar um novo UUID aqui — o frontend e a fonte de verdade do event_id
 * - Sem capiEventId, o event_id cai para `purchase_{orderId}`: polling e webhook
 *   geram o mesmo ID e a Meta conta uma venda so
 *
 * Exemplo de uso no webhook do gateway:
 *   const payment = await db.payment.findUnique(...)
 *   sendPurchase({
 *     eventId: payment.capiEventId ?? undefined, // ID do frontend
 *     user: { email: payment.email, phone: payment.phone, ... },
 *     context: {
 *       fbp: payment.fbp ?? undefined,
 *       fbc: payment.fbc ?? undefined,
 *       ipAddress: payment.ipAddress ?? undefined,
 *       userAgent: payment.userAgent ?? undefined,
 *     },
 *     products: [{ id: payment.productSlug, price: payment.amount }],
 *     value: payment.amount,
 *     orderId: payment.id,
 *     eventTime: Math.floor(payment.confirmedAt.getTime() / 1000), // hora real da venda
 *   }).catch(err => console.error('[CAPI] Purchase:', err))
 *
 * DEDUPLICACAO:
 * O pixel browser, o polling do frontend e o webhook podem todos disparar Purchase.
 * Desde que usem o mesmo event_id, a Meta conta apenas 1 conversao. Este e o
 * comportamento correto — nao tente evitar o envio duplicado, apenas use o mesmo ID.
 */
export async function sendPurchase(options: {
  /** event_id salvo no banco (do frontend) — OBRIGATORIO para deduplicacao */
  eventId?: string
  user: UserCAPIData
  context: CAPIContext
  products: CAPIProduct[]
  /** Valor total pago */
  value: number
  /** Moeda — padrao "BRL" */
  currency?: string
  /** ID do pedido no seu sistema */
  orderId?: string
  /** Numero de itens comprados */
  numItems?: number
  /** URL da pagina de confirmacao */
  eventSourceUrl?: string
  /** Hora real da venda (Unix em SEGUNDOS). Padrao: agora. Maximo 7 dias atras. */
  eventTime?: number
  /** Padrao 'website'. Venda fechada no CRM: canal real do fechamento. */
  actionSource?: ActionSource
  /**
   * Campos extras em custom_data (ex: UTMs com os IDs de campanha guardados no CRM).
   * A Meta guarda para relatorio e conversao personalizada, mas NAO usa para
   * atribuir: quem liga a venda ao anuncio e o user_data (fbc, telefone, email).
   */
  extraCustomData?: Record<string, unknown>
}): Promise<void> {
  const customData: Record<string, unknown> = {
    ...options.extraCustomData,
    value: options.value,
    currency: options.currency ?? 'BRL',
  }

  if (options.orderId) {
    customData.order_id = options.orderId
  }

  if (options.products.length > 0) {
    customData.content_ids = options.products.map(p => p.id)
    customData.content_type = 'product'
    customData.num_items = options.numItems ?? options.products.reduce((acc, p) => acc + (p.quantity ?? 1), 0)
    customData.contents = options.products.map(p => ({
      id: p.id,
      quantity: p.quantity ?? 1,
      item_price: p.price,
    }))
  }

  return sendCAPIEvent({
    eventName: 'Purchase',
    // Ordem: eventId explicito > capiEventId salvo no checkout > purchase_{orderId}.
    // O ultimo e deterministico: qualquer canal que mande o mesmo pedido gera o mesmo ID.
    eventId: options.eventId
      ?? options.context.capiEventId
      ?? (options.orderId ? `purchase_${options.orderId}` : undefined),
    eventTime: options.eventTime,
    actionSource: options.actionSource,
    context: options.context,
    user: options.user,
    eventSourceUrl: options.eventSourceUrl,
    customData,
  })
}
