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
 * Deduplicação CAPI: gere o event_id AQUI e passe-o também
 * para o backend ao criar o pagamento. O backend inclui o
 * mesmo event_id no request da Conversions API server-side.
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
  /** SHA-256 do telefone em formato E.164 (ex: +5511999999999) */
  phone: string
  /** ID externo do usuário — NÃO hasheado (UUID ou ID interno) */
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
}

/** Resultado de trackPurchase — inclui o event_id gerado para envio ao backend. */
export interface PurchaseTrackingResult {
  /** UUID gerado no frontend. Deve ser enviado ao backend para uso na CAPI. */
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
 * Normaliza um número de telefone para formato E.164.
 * Assume Brasil como padrão se não houver DDI.
 * Remove todos os caracteres não numéricos antes de processar.
 *
 * Exemplos:
 *   "(11) 99999-9999"    → "+5511999999999"
 *   "11999999999"        → "+5511999999999"
 *   "+5511999999999"     → "+5511999999999"
 *
 * @param phone - número de telefone em qualquer formato
 * @param defaultCountryCode - DDI padrão se não encontrado (default: "55" para Brasil)
 */
export function normalizePhone(
  phone: string,
  defaultCountryCode = '55',
): string {
  // Remove tudo que não for dígito
  const digits = phone.replace(/\D/g, '')

  // Já tem DDI do Brasil (começa com 55 e tem 12 ou 13 dígitos)
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`
  }

  // Número brasileiro sem DDI (10 ou 11 dígitos — DDD + número)
  if (digits.length === 10 || digits.length === 11) {
    return `+${defaultCountryCode}${digits}`
  }

  // Retorna com + se já tiver DDI implícito em outros formatos
  return `+${digits}`
}

/**
 * Lê os cookies de rastreamento do Meta Pixel do documento.
 *
 * - `_fbp`: identificador de browser gerado pelo Pixel (fb.1.timestamp.random)
 * - `_fbc`: parâmetro fbclid da URL quando o usuário clicou num anúncio Meta
 *
 * Esses valores são passados ao CAPI para melhorar o match de eventos.
 *
 * @returns objeto com fbp e fbc (ambos podem ser undefined se não existirem)
 */
export function readMetaCookies(): { fbp?: string; fbc?: string } {
  if (typeof document === 'undefined') return {}

  const cookies = document.cookie.split('; ').reduce<Record<string, string>>(
    (acc, cookie) => {
      const [key, value] = cookie.split('=')
      if (key && value) acc[key.trim()] = decodeURIComponent(value)
      return acc
    },
    {},
  )

  return {
    fbp: cookies['_fbp'],
    fbc: cookies['_fbc'],
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
 *
 * @param rawEmail     - email em texto puro (será hasheado aqui)
 * @param rawFirstName - primeiro nome em texto puro
 * @param rawLastName  - sobrenome em texto puro
 * @param rawPhone     - telefone em qualquer formato (será normalizado e hasheado)
 * @param userId       - ID único do usuário no sistema (NÃO hasheado)
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

  const [hashedEmail, hashedFn, hashedLn, hashedPhone] = await Promise.all([
    sha256(rawEmail),
    sha256(rawFirstName),
    sha256(rawLastName),
    sha256(normalizedPhone),
  ])

  const userData: UserData = {
    email: hashedEmail,
    fn: hashedFn,
    ln: hashedLn,
    phone: hashedPhone,
    external_id: userId,
    ...(fbp && { fbp }),
    ...(fbc && { fbc }),
  }

  window.dataLayer.push({ user: userData })

  return userData
}

// ---------------------------------------------------------------------------
// Eventos de rastreamento
// ---------------------------------------------------------------------------

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

  // Push 1 — Meta Pixel
  window.dataLayer.push({
    event: 'InitiateCheckout',
    content_ids: [product.productId],
    content_type: 'product',
    value: product.price,
    currency: 'BRL',
    num_items: 1,
    event_id: crypto.randomUUID(),
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
    event_id: crypto.randomUUID(),
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
 * CRÍTICO: esta função gera um event_id único que DEVE ser
 * enviado ao backend para uso na Meta Conversions API (CAPI).
 * Sem o mesmo event_id em ambos (Pixel browser + CAPI server),
 * a Meta vai contar a conversão duas vezes.
 *
 * Fluxo correto:
 *   1. Chame trackPurchase() → obtém { eventId }
 *   2. Inclua eventId no body do POST ao backend
 *   3. Backend inclui eventId no request da CAPI
 *
 * Envia dois pushes:
 *  1. Meta: event='Purchase'
 *  2. GA4:  event='purchase' (dentro de ecommerce{})
 *
 * @param product - dados do produto, método de pagamento e ID da transação
 * @returns { eventId } — UUID gerado; envie ao backend para CAPI
 */
export function trackPurchase(
  product: ProductPayload & { paymentMethod: string; transactionId: string },
): PurchaseTrackingResult {
  ensureDataLayer()

  /**
   * event_id: UUID gerado no browser NO MOMENTO do evento.
   *
   * Por que crypto.randomUUID() e não Date.now()?
   * A Meta exige unicidade global por evento. UUIDs v4 têm 122 bits
   * de aleatoriedade; timestamps podem colidir em alto volume.
   *
   * Este mesmo eventId deve viajar para o backend e ser incluído
   * na chamada à Conversions API para que a Meta possa deduplica.
   */
  const eventId = crypto.randomUUID()

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
