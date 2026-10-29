/**
 * frontend-tracking.ts
 *
 * Módulo genérico de rastreamento via dataLayer para GTM.
 * Compatível com Meta Pixel (via GTM) e GA4 (via GTM).
 *
 * Padrão: dois pushes por evento de conversão —
 *   1. Push Meta (PascalCase, campos na raiz)
 *   2. Push GA4  (snake_case, campos dentro de ecommerce{})
 *
 * Deduplicação CAPI: gere UM checkoutId quando o checkout abre
 * (newCheckoutId()), guarde no estado, mande ao backend no POST que
 * cria o pagamento e passe esse MESMO ID como eventId em
 * InitiateCheckout, AddPaymentInfo e Purchase. O backend salva o ID
 * no banco e usa o mesmo valor na Conversions API. A Meta deduplica
 * quando event_name e event_id batem, então reaproveitar o ID em
 * eventos de nomes diferentes é seguro.
 *
 * Nenhum Pixel ID ou credencial está hardcoded aqui.
 * O GTM cuida da entrega; este módulo só alimenta o dataLayer.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Dados do usuário a serem mantidos no dataLayer (sempre hasheados). */
export interface UserData {
  /** SHA-256 do email em lowercase sem espaços */
  email: string
  /** SHA-256 do primeiro nome em lowercase */
  fn: string
  /** SHA-256 do sobrenome em lowercase */
  ln: string
  /** SHA-256 do telefone só com dígitos, com DDI e SEM "+" (ex: 5511999999999) */
  phone: string
  /** SHA-256 do ID interno do usuário (mesmo hash que o backend manda na CAPI) */
  external_id: string
  /** Cookie _fbp lido do browser (gerado pelo Pixel ao carregar) */
  fbp?: string
  /** Cookie _fbc lido do browser (parâmetro fbclid da URL) */
  fbc?: string
}

/** Item de produto para eventos de ecommerce GA4. */
export interface EcommerceItem {
  item_id: string
  item_name: string
  price: number
  quantity: number
  item_category?: string
  item_variant?: string
}

/** Payload base para eventos de produto. */
export interface ProductPayload {
  productId: string
  productName: string
  price: number
  paymentMethod?: string
  /** ID de transação (ex: ID do pagamento no gateway). Obrigatório em Purchase. */
  transactionId?: string
  /**
   * checkoutId gerado por newCheckoutId() quando o checkout abriu.
   * É o mesmo valor que o backend salvou e usa na CAPI.
   */
  eventId?: string
}

/** Resultado de trackPurchase — devolve o event_id usado no push. */
export interface PurchaseTrackingResult {
  eventId: string
}

// ---------------------------------------------------------------------------
// Utilitários internos
// ---------------------------------------------------------------------------

/**
 * Garante que window.dataLayer existe.
 * Chame isso antes de qualquer push.
 */
function ensureDataLayer(): void {
  if (typeof window === 'undefined') return
  window.dataLayer = window.dataLayer || []
}

/**
 * Calcula SHA-256 de uma string usando a Web Crypto API nativa.
 * Aplica lowercase e trim antes de hashar (exigência da Meta).
 *
 * @param value - string a ser hasheada
 * @returns hex string do hash SHA-256
 */
export async function sha256(value: string): Promise<string> {
  const normalized = value.toLowerCase().trim()
  const msgBuffer = new TextEncoder().encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Normaliza um telefone para o formato que a META espera antes do hash:
 * só dígitos, com DDI, SEM o "+" (ex: "5511999999999").
 * Tem que dar exatamente o mesmo resultado que normalizePhone do backend,
 * senão o hash do navegador e o do servidor não batem.
 *
 * Exemplos:
 *   "(11) 99999-9999"    → "5511999999999"
 *   "11999999999"        → "5511999999999"
 *   "+55 11 99999-9999"  → "5511999999999"
 *   "+1 415 555 2671"    → "14155552671"
 *
 * Atenção: o Google quer E.164 COM "+" antes do hash. Ver pii-hashing.md.
 *
 * @param phone - número de telefone em qualquer formato
 * @param defaultCountryCode - DDI usado quando o número vem sem DDI (padrão "55")
 */
export function normalizePhone(
  phone: string,
  defaultCountryCode = '55',
): string {
  const hadPlus = phone.trim().startsWith('+')
  let digits = phone.replace(/\D/g, '')

  // Veio com "+": o DDI já está no número
  if (hadPlus) return digits

  // Já tem DDI do Brasil (55 + DDD + número = 12 ou 13 dígitos)
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits
  }

  // Remove o 0 de discagem de longa distância
  if (digits.startsWith('0')) digits = digits.slice(1)

  return `${defaultCountryCode}${digits}`
}

/**
 * Gera o ID do checkout. Chame UMA vez quando o checkout abrir e reutilize
 * o valor em todos os eventos desse checkout e no POST ao backend.
 */
export function newCheckoutId(): string {
  return crypto.randomUUID()
}

/**
 * Lê os cookies de rastreamento do Meta Pixel do documento.
 *
 * - `_fbp`: identificador de browser gerado pelo Pixel (fb.1.timestamp.random)
 * - `_fbc`: click ID no formato fb.1.{timestamp_ms}.{fbclid}
 *
 * Se o `_fbc` não existe (ad blocker, pixel bloqueado) mas a URL tem `fbclid`,
 * monta o fbc no formato certo. O fbclid cru NÃO serve como fbc, e o valor
 * nunca pode ter maiúsculas/minúsculas alteradas.
 *
 * O fbclid some da URL na navegação seguinte: para não perdê-lo, use
 * scripts/captura-origem.js na primeira página.
 *
 * @returns objeto com fbp e fbc (ambos podem ser undefined se não existirem)
 */
export function readMetaCookies(): { fbp?: string; fbc?: string } {
  if (typeof document === 'undefined') return {}

  const cookies = document.cookie.split('; ').reduce<Record<string, string>>(
    (acc, cookie) => {
      const i = cookie.indexOf('=')
      if (i > 0) acc[cookie.slice(0, i).trim()] = decodeURIComponent(cookie.slice(i + 1))
      return acc
    },
    {},
  )

  let fbc = cookies['_fbc']
  if (!fbc) {
    const fbclid = new URLSearchParams(window.location.search).get('fbclid')
    if (fbclid) fbc = `fb.1.${Date.now()}.${fbclid}`
  }

  return {
    fbp: cookies['_fbp'],
    fbc,
  }
}

// ---------------------------------------------------------------------------
// Identidade do usuário
// ---------------------------------------------------------------------------

/**
 * Persiste os dados do usuário no dataLayer.
 *
 * Deve ser chamado:
 * - Logo após login ou cadastro
 * - Ao montar o componente de checkout (se usuário já logado)
 * - Antes de qualquer evento de conversão que precise de Advanced Matching
 *
 * Como o dataLayer é cumulativo, uma vez setado o objeto `user`,
 * ele ficará disponível para todas as tags GTM nos eventos seguintes.
 * O push leva event='user_identified', que dispara a tag de Advanced
 * Matching do Meta (ver gtm-setup.md).
 *
 * @param rawEmail     - email em texto puro (será hasheado aqui)
 * @param rawFirstName - primeiro nome em texto puro
 * @param rawLastName  - sobrenome em texto puro
 * @param rawPhone     - telefone em qualquer formato (será normalizado e hasheado)
 * @param userId       - ID único do usuário no sistema (será hasheado, igual ao backend)
 */
export async function setUserInDataLayer({
  rawEmail,
  rawFirstName,
  rawLastName,
  rawPhone,
  userId,
}: {
  rawEmail: string
  rawFirstName: string
  rawLastName: string
  rawPhone: string
  userId: string
}): Promise<UserData> {
  ensureDataLayer()

  const normalizedPhone = normalizePhone(rawPhone)
  const { fbp, fbc } = readMetaCookies()

  const [hashedEmail, hashedFn, hashedLn, hashedPhone, hashedUserId] = await Promise.all([
    sha256(rawEmail),
    sha256(rawFirstName),
    sha256(rawLastName),
    sha256(normalizedPhone),
    sha256(String(userId)),
  ])

  const userData: UserData = {
    email: hashedEmail,
    fn: hashedFn,
    ln: hashedLn,
    phone: hashedPhone,
    external_id: hashedUserId,
    ...(fbp && { fbp }),
    ...(fbc && { fbc }),
  }

  window.dataLayer.push({ event: 'user_identified', user: userData })

  return userData
}

// ---------------------------------------------------------------------------
// Eventos de rastreamento
// ---------------------------------------------------------------------------

/**
 * Dispara Lead: formulário de contato enviado com sucesso.
 *
 * Chame DEPOIS que o backend respondeu com o idLead, e use `lead_{idLead}`:
 * é o mesmo event_id que o backend manda na CAPI (sendLead).
 *
 * Envia dois pushes:
 *  1. Meta: event='Lead'
 *  2. GA4:  event='generate_lead'
 *
 * @param leadId - ID do lead devolvido pelo backend
 */
export function trackLead(leadId: string): void {
  ensureDataLayer()

  // Push 1 — Meta Pixel
  window.dataLayer.push({
    event: 'Lead',
    event_id: `lead_${leadId}`,
  })

  // Push 2 — GA4
  window.dataLayer.push({
    event: 'generate_lead',
  })
}

/**
 * Dispara CompleteRegistration — cadastro ou login bem-sucedido.
 *
 * Envia dois pushes:
 *  1. Meta: event='CompleteRegistration'
 *  2. GA4:  event='sign_up'
 *
 * @param method - método de autenticação (ex: 'magic_code', 'magic_link', 'google')
 * @param contentName - contexto do registro (ex: 'login', 'signup', 'checkout_login')
 */
export function trackCompleteRegistration({
  method = 'magic_code',
  contentName = 'login',
}: {
  method?: string
  contentName?: string
} = {}): void {
  ensureDataLayer()

  // Push 1 — Meta Pixel
  window.dataLayer.push({
    event: 'CompleteRegistration',
    content_name: contentName,
    status: true,
    event_id: crypto.randomUUID(),
  })

  // Push 2 — GA4
  window.dataLayer.push({
    event: 'sign_up',
    method,
  })
}

/**
 * Dispara ViewContent — usuário visualizou a página/modal do produto.
 *
 * Envia dois pushes:
 *  1. Meta: event='ViewContent'
 *  2. GA4:  event='view_item' (dentro de ecommerce{})
 *
 * @param product - dados do produto visualizado
 */
export function trackViewContent(product: ProductPayload): void {
  ensureDataLayer()

  // Push 1 — Meta Pixel
  window.dataLayer.push({
    event: 'ViewContent',
    content_ids: [product.productId],
    content_type: 'product',
    content_name: product.productName,
    value: product.price,
    currency: 'BRL',
    event_id: crypto.randomUUID(),
  })

  // Push 2 — GA4 Enhanced Ecommerce
  // Limpar ecommerce anterior antes de pushar novo evento
  window.dataLayer.push({ ecommerce: null })
  window.dataLayer.push({
    event: 'view_item',
    ecommerce: {
      currency: 'BRL',
      value: product.price,
      items: [
        {
          item_id: product.productId,
          item_name: product.productName,
          price: product.price,
          quantity: 1,
          item_category: 'digital',
        } satisfies EcommerceItem,
      ],
    },
  })
}

/**
 * Dispara InitiateCheckout — usuário abriu o fluxo de checkout.
 *
 * Envia dois pushes:
 *  1. Meta: event='InitiateCheckout'
 *  2. GA4:  event='begin_checkout' (dentro de ecommerce{})
 *
 * @param product - dados do produto no checkout
 */
export function trackInitiateCheckout(product: ProductPayload): void {
  ensureDataLayer()

  // Push 1 — Meta Pixel (event_id = checkoutId, o mesmo que o backend usa na CAPI)
  window.dataLayer.push({
    event: 'InitiateCheckout',
    content_ids: [product.productId],
    content_type: 'product',
    value: product.price,
    currency: 'BRL',
    num_items: 1,
    event_id: product.eventId ?? crypto.randomUUID(),
  })

  // Push 2 — GA4 Enhanced Ecommerce
  window.dataLayer.push({ ecommerce: null })
  window.dataLayer.push({
    event: 'begin_checkout',
    ecommerce: {
      currency: 'BRL',
      value: product.price,
      items: [
        {
          item_id: product.productId,
          item_name: product.productName,
          price: product.price,
          quantity: 1,
          item_category: 'digital',
        } satisfies EcommerceItem,
      ],
    },
  })
}

/**
 * Dispara AddPaymentInfo — usuário preencheu dados de pagamento.
 *
 * Envia dois pushes:
 *  1. Meta: event='AddPaymentInfo'
 *  2. GA4:  event='add_payment_info' (dentro de ecommerce{})
 *
 * @param product - dados do produto, incluindo método de pagamento
 */
export function trackAddPaymentInfo(
  product: ProductPayload & { paymentMethod: string },
): void {
  ensureDataLayer()

  // Push 1 — Meta Pixel
  window.dataLayer.push({
    event: 'AddPaymentInfo',
    content_ids: [product.productId],
    content_type: 'product',
    value: product.price,
    currency: 'BRL',
    payment_method: product.paymentMethod,
    event_id: product.eventId ?? crypto.randomUUID(),
  })

  // Push 2 — GA4 Enhanced Ecommerce
  window.dataLayer.push({ ecommerce: null })
  window.dataLayer.push({
    event: 'add_payment_info',
    ecommerce: {
      currency: 'BRL',
      value: product.price,
      payment_type: product.paymentMethod,
      items: [
        {
          item_id: product.productId,
          item_name: product.productName,
          price: product.price,
          quantity: 1,
          item_category: 'digital',
        } satisfies EcommerceItem,
      ],
    },
  })
}

/**
 * Dispara Purchase — pagamento confirmado.
 *
 * CRÍTICO: o eventId tem que ser o MESMO que o backend usa na CAPI.
 * Esta função não gera ID: ela recebe o checkoutId criado quando o
 * checkout abriu (newCheckoutId()) e que o backend salvou no banco.
 * Se o backend manda o Purchase pelo webhook com um ID e o navegador
 * manda com outro, a Meta conta duas vendas.
 *
 * Fluxo correto:
 *   1. Checkout abre → checkoutId = newCheckoutId()
 *   2. POST ao backend leva checkoutId (o backend salva como capiEventId)
 *   3. Pagamento confirmado → trackPurchase({ ..., eventId: checkoutId })
 *   4. Webhook do backend manda CAPI Purchase com o capiEventId salvo
 *
 * Envia dois pushes:
 *  1. Meta: event='Purchase'
 *  2. GA4:  event='purchase' (dentro de ecommerce{})
 *
 * @param product - dados do produto, método de pagamento, ID da transação e eventId
 * @returns { eventId } — o ID usado no push
 */
export function trackPurchase(
  product: ProductPayload & { paymentMethod: string; transactionId: string; eventId: string },
): PurchaseTrackingResult {
  ensureDataLayer()

  const eventId = product.eventId

  // Push 1 — Meta Pixel
  window.dataLayer.push({
    event: 'Purchase',
    content_ids: [product.productId],
    content_type: 'product',
    value: product.price,
    currency: 'BRL',
    num_items: 1,
    transaction_id: product.transactionId,
    payment_method: product.paymentMethod,
    event_id: eventId,
  })

  // Push 2 — GA4 Enhanced Ecommerce
  // Limpar ecommerce anterior antes de pushar novo evento
  window.dataLayer.push({ ecommerce: null })
  window.dataLayer.push({
    event: 'purchase',
    ecommerce: {
      transaction_id: product.transactionId,
      value: product.price,
      currency: 'BRL',
      payment_type: product.paymentMethod,
      items: [
        {
          item_id: product.productId,
          item_name: product.productName,
          price: product.price,
          quantity: 1,
          item_category: 'digital',
        } satisfies EcommerceItem,
      ],
    },
  })

  return { eventId }
}

// ---------------------------------------------------------------------------
// Declaração global para TypeScript
// ---------------------------------------------------------------------------

// Augmenta o tipo de Window para incluir dataLayer sem erros de TypeScript
declare global {
  interface Window {
    dataLayer: Record<string, unknown>[]
  }
}
