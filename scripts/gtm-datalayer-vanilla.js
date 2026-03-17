/**
 * gtm-datalayer-vanilla.js
 *
 * Exemplos em JavaScript puro (sem TypeScript, sem frameworks).
 * Funciona em qualquer site: WordPress, Shopify, HTML estático, etc.
 *
 * Como usar:
 *   1. Inclua o snippet do GTM no <head> do seu site
 *   2. Inclua este script APÓS o snippet do GTM
 *   3. Chame as funções nos eventos corretos (clique, login, pagamento, etc.)
 *
 * Como o GTM consome estes dados:
 *   - O GTM escuta o array window.dataLayer
 *   - Quando você faz dataLayer.push({ event: 'Purchase', ... }),
 *     o GTM dispara todas as tags configuradas para o trigger 'Purchase'
 *   - As tags do Meta Pixel e GA4 leem as variáveis definidas no push
 *   - Você não precisa chamar fbq() ou gtag() diretamente — o GTM faz isso
 *
 * IMPORTANTE: Nenhum Pixel ID ou Measurement ID está hardcoded aqui.
 * Configure esses IDs diretamente nas tags do GTM.
 */

// ---------------------------------------------------------------------------
// CONFIGURAÇÃO INICIAL
// ---------------------------------------------------------------------------

/**
 * initDataLayer()
 * Inicializa o array global dataLayer se ainda não existir.
 *
 * Chame esta função no início do seu script, antes de qualquer evento.
 * Se o GTM já foi carregado antes deste script, ele já terá criado o
 * dataLayer — esta função garante que existirá em qualquer ordem.
 */
function initDataLayer() {
  window.dataLayer = window.dataLayer || [];
  console.log('[Tracking] dataLayer inicializado');
}

// Inicializa imediatamente ao carregar o script
initDataLayer();

// ---------------------------------------------------------------------------
// UTILITÁRIOS
// ---------------------------------------------------------------------------

/**
 * sha256Hash(texto)
 * Calcula o hash SHA-256 de uma string usando a Web Crypto API nativa.
 *
 * A Meta exige que dados pessoais sejam hasheados com SHA-256 antes
 * de serem enviados. O processo é:
 *   - Converter para minúsculas
 *   - Remover espaços extras
 *   - Codificar em UTF-8
 *   - Calcular SHA-256
 *   - Retornar como string hexadecimal
 *
 * @param {string} texto - valor a ser hasheado (email, nome, telefone)
 * @returns {Promise<string>} hash em formato hexadecimal
 *
 * Exemplo:
 *   sha256Hash('joao@exemplo.com').then(hash => console.log(hash))
 *   // "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3"
 */
async function sha256Hash(texto) {
  // Normaliza: minúsculas e sem espaços nas bordas
  const normalizado = texto.toLowerCase().trim();

  // Converte string para bytes UTF-8
  const dados = new TextEncoder().encode(normalizado);

  // Calcula SHA-256 usando API nativa do browser
  const hashBuffer = await crypto.subtle.digest('SHA-256', dados);

  // Converte ArrayBuffer para string hexadecimal
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * normalizarTelefone(telefone)
 * Converte um número de telefone para o formato E.164.
 *
 * O formato E.164 é exigido pela Meta para o campo `ph` (phone).
 * Exemplos: +5511999999999, +5521999999999
 *
 * @param {string} telefone - número em qualquer formato
 * @param {string} ddi - código do país (padrão: '55' para Brasil)
 * @returns {string} número no formato E.164
 */
function normalizarTelefone(telefone, ddi = '55') {
  // Remove tudo que não for número
  const apenasDigitos = telefone.replace(/\D/g, '');

  // Já tem DDI do Brasil (começa com 55, 12 ou 13 dígitos)
  if (apenasDigitos.startsWith('55') && (apenasDigitos.length === 12 || apenasDigitos.length === 13)) {
    return '+' + apenasDigitos;
  }

  // Número brasileiro sem DDI (10 ou 11 dígitos: DDD + número)
  if (apenasDigitos.length === 10 || apenasDigitos.length === 11) {
    return '+' + ddi + apenasDigitos;
  }

  // Outros casos: apenas adiciona o +
  return '+' + apenasDigitos;
}

/**
 * lerCookiesMeta()
 * Lê os cookies _fbp e _fbc do browser.
 *
 * - _fbp: cookie gerado pelo Meta Pixel ao carregar na página
 *         Identifica o browser do visitante
 * - _fbc: gerado quando o visitante clicou em um anúncio Meta
 *         Contém o parâmetro fbclid da URL
 *
 * Esses valores melhoram a qualidade do match na Conversions API (CAPI).
 *
 * @returns {{ fbp: string|null, fbc: string|null }}
 */
function lerCookiesMeta() {
  const cookies = document.cookie.split('; ').reduce(function(acc, cookie) {
    const partes = cookie.split('=');
    if (partes[0] && partes[1]) {
      acc[partes[0].trim()] = decodeURIComponent(partes[1]);
    }
    return acc;
  }, {});

  return {
    fbp: cookies['_fbp'] || null,
    fbc: cookies['_fbc'] || null,
  };
}

// ---------------------------------------------------------------------------
// IDENTIDADE DO USUÁRIO
// ---------------------------------------------------------------------------

/**
 * setUser(dadosUsuario)
 * Persiste os dados do usuário no dataLayer (com hashing automático).
 *
 * Deve ser chamado:
 *   - Logo após login ou cadastro do usuário
 *   - Antes de abrir o checkout (se o usuário já estiver logado)
 *   - No carregamento da página se o usuário estiver logado
 *
 * Por que pushar antes dos eventos de checkout?
 *   O dataLayer mantém estado cumulativo. Uma vez que os dados do
 *   usuário estão no dataLayer, todas as tags do GTM podem lê-los
 *   nos eventos seguintes sem precisar reenviá-los.
 *
 * @param {Object} dadosUsuario
 * @param {string} dadosUsuario.email       - email do usuário (texto puro)
 * @param {string} dadosUsuario.primeiroNome - primeiro nome (texto puro)
 * @param {string} dadosUsuario.sobrenome   - sobrenome (texto puro)
 * @param {string} dadosUsuario.telefone    - telefone em qualquer formato
 * @param {string} dadosUsuario.userId      - ID único no sistema (NÃO hasheado)
 */
async function setUser(dadosUsuario) {
  const telefonePadronizado = normalizarTelefone(dadosUsuario.telefone);
  const cookiesMeta = lerCookiesMeta();

  // Hasheia todos os dados pessoais em paralelo para performance
  const [emailHash, fnHash, lnHash, phoneHash] = await Promise.all([
    sha256Hash(dadosUsuario.email),
    sha256Hash(dadosUsuario.primeiroNome),
    sha256Hash(dadosUsuario.sobrenome),
    sha256Hash(telefonePadronizado),
  ]);

  const objetoUser = {
    email: emailHash,
    fn: fnHash,
    ln: lnHash,
    phone: phoneHash,
    external_id: dadosUsuario.userId, // ID interno: NÃO hasheia
  };

  // Adiciona cookies do Meta Pixel se disponíveis
  if (cookiesMeta.fbp) objetoUser.fbp = cookiesMeta.fbp;
  if (cookiesMeta.fbc) objetoUser.fbc = cookiesMeta.fbc;

  window.dataLayer.push({ user: objetoUser });
  console.log('[Tracking] Usuário setado no dataLayer');
}

// ---------------------------------------------------------------------------
// EVENTOS DO FUNIL
// ---------------------------------------------------------------------------

/**
 * trackCompleteRegistration(opcoes)
 * Dispara o evento de cadastro ou login bem-sucedido.
 *
 * Quando usar:
 *   - Após confirmação de login por OTP/magic code
 *   - Após criação de conta bem-sucedida
 *   - Após autenticação social (Google, Facebook, etc.)
 *
 * Envia dois pushes:
 *   1. Meta Pixel: event='CompleteRegistration'
 *   2. GA4:        event='sign_up'
 *
 * @param {Object} opcoes
 * @param {string} opcoes.metodo      - método de auth (ex: 'magic_code', 'google')
 * @param {string} opcoes.nomeConteudo - contexto (ex: 'login', 'signup', 'checkout')
 */
function trackCompleteRegistration(opcoes) {
  opcoes = opcoes || {};
  const metodo = opcoes.metodo || 'magic_code';
  const nomeConteudo = opcoes.nomeConteudo || 'login';

  // Push 1 — Meta Pixel (PascalCase no nome do evento)
  window.dataLayer.push({
    event: 'CompleteRegistration',
    content_name: nomeConteudo,
    status: true,
    event_id: crypto.randomUUID(),
  });

  // Push 2 — GA4 (snake_case no nome do evento)
  window.dataLayer.push({
    event: 'sign_up',
    method: metodo,
  });

  console.log('[Tracking] CompleteRegistration disparado');
}

/**
 * trackViewContent(produto)
 * Dispara o evento quando o usuário visualiza um produto.
 *
 * Quando usar:
 *   - Ao carregar a página de produto
 *   - Ao abrir um modal de detalhes do produto
 *   - Ao exibir um card de produto em destaque
 *
 * Envia dois pushes:
 *   1. Meta Pixel: event='ViewContent'
 *   2. GA4:        event='view_item' (dentro de ecommerce{})
 *
 * @param {Object} produto
 * @param {string} produto.id     - ID único do produto (ex: 'kit-completo')
 * @param {string} produto.nome   - nome do produto
 * @param {number} produto.preco  - preço em reais (ex: 47.90)
 */
function trackViewContent(produto) {
  // Push 1 — Meta Pixel
  window.dataLayer.push({
    event: 'ViewContent',
    content_ids: [produto.id],
    content_type: 'product',
    content_name: produto.nome,
    value: produto.preco,
    currency: 'BRL',
    event_id: crypto.randomUUID(),
  });

  // Push 2 — GA4 Enhanced Ecommerce
  // IMPORTANTE: sempre limpar ecommerce anterior antes de pushar novo evento
  window.dataLayer.push({ ecommerce: null });
  window.dataLayer.push({
    event: 'view_item',
    ecommerce: {
      currency: 'BRL',
      value: produto.preco,
      items: [{
        item_id: produto.id,
        item_name: produto.nome,
        price: produto.preco,
        quantity: 1,
        item_category: 'digital',
      }],
    },
  });

  console.log('[Tracking] ViewContent disparado para:', produto.id);
}

/**
 * trackInitiateCheckout(produto)
 * Dispara o evento quando o usuário inicia o checkout.
 *
 * Quando usar:
 *   - Ao clicar em "Comprar agora"
 *   - Ao abrir o modal/página de checkout
 *   - Na primeira exibição do formulário de pagamento
 *
 * Envia dois pushes:
 *   1. Meta Pixel: event='InitiateCheckout'
 *   2. GA4:        event='begin_checkout' (dentro de ecommerce{})
 *
 * @param {Object} produto
 * @param {string} produto.id    - ID único do produto
 * @param {string} produto.nome  - nome do produto
 * @param {number} produto.preco - preço em reais
 */
function trackInitiateCheckout(produto) {
  // Push 1 — Meta Pixel
  window.dataLayer.push({
    event: 'InitiateCheckout',
    content_ids: [produto.id],
    content_type: 'product',
    value: produto.preco,
    currency: 'BRL',
    num_items: 1,
    event_id: crypto.randomUUID(),
  });

  // Push 2 — GA4 Enhanced Ecommerce
  window.dataLayer.push({ ecommerce: null });
  window.dataLayer.push({
    event: 'begin_checkout',
    ecommerce: {
      currency: 'BRL',
      value: produto.preco,
      items: [{
        item_id: produto.id,
        item_name: produto.nome,
        price: produto.preco,
        quantity: 1,
        item_category: 'digital',
      }],
    },
  });

  console.log('[Tracking] InitiateCheckout disparado para:', produto.id);
}

/**
 * trackAddPaymentInfo(produto)
 * Dispara o evento quando o usuário preenche os dados de pagamento.
 *
 * Quando usar:
 *   - Ao selecionar método de pagamento (PIX ou cartão)
 *   - Ao submeter o formulário de cartão de crédito
 *   - Ao gerar o QR code PIX (usuário "escolheu" PIX)
 *
 * Envia dois pushes:
 *   1. Meta Pixel: event='AddPaymentInfo'
 *   2. GA4:        event='add_payment_info' (dentro de ecommerce{})
 *
 * @param {Object} produto
 * @param {string} produto.id              - ID único do produto
 * @param {string} produto.nome            - nome do produto
 * @param {number} produto.preco           - preço em reais
 * @param {string} produto.metodoPagamento - 'PIX' ou 'credit_card'
 */
function trackAddPaymentInfo(produto) {
  // Push 1 — Meta Pixel
  window.dataLayer.push({
    event: 'AddPaymentInfo',
    content_ids: [produto.id],
    content_type: 'product',
    value: produto.preco,
    currency: 'BRL',
    payment_method: produto.metodoPagamento,
    event_id: crypto.randomUUID(),
  });

  // Push 2 — GA4 Enhanced Ecommerce
  window.dataLayer.push({ ecommerce: null });
  window.dataLayer.push({
    event: 'add_payment_info',
    ecommerce: {
      currency: 'BRL',
      value: produto.preco,
      payment_type: produto.metodoPagamento,
      items: [{
        item_id: produto.id,
        item_name: produto.nome,
        price: produto.preco,
        quantity: 1,
        item_category: 'digital',
      }],
    },
  });

  console.log('[Tracking] AddPaymentInfo disparado:', produto.metodoPagamento);
}

/**
 * trackPurchase(produto)
 * Dispara o evento de compra confirmada.
 *
 * ATENÇÃO — Deduplicação com CAPI:
 *   Esta função gera um event_id único. Para que a Meta não conte
 *   a mesma compra duas vezes (Pixel browser + CAPI server-side),
 *   você DEVE enviar este mesmo event_id para o seu backend.
 *   O backend inclui o event_id no request da Conversions API.
 *
 *   Exemplo de fluxo:
 *     const resultado = await trackPurchase({ ... });
 *     await fetch('/api/confirmar-pagamento', {
 *       method: 'POST',
 *       body: JSON.stringify({
 *         pagamentoId: 'PAY_123',
 *         eventId: resultado.eventId, // <-- essencial!
 *       })
 *     });
 *
 * Envia dois pushes:
 *   1. Meta Pixel: event='Purchase'
 *   2. GA4:        event='purchase' (dentro de ecommerce{})
 *
 * @param {Object} produto
 * @param {string} produto.id              - ID único do produto
 * @param {string} produto.nome            - nome do produto
 * @param {number} produto.preco           - preço em reais
 * @param {string} produto.metodoPagamento - 'PIX' ou 'credit_card'
 * @param {string} produto.idTransacao     - ID do pagamento no gateway
 * @returns {{ eventId: string }} event_id gerado — envie ao backend para CAPI
 */
function trackPurchase(produto) {
  /**
   * event_id: identificador único para este evento de conversão.
   *
   * O mesmo event_id deve ir para:
   *   - Este push no dataLayer (Meta Pixel browser-side vai usar)
   *   - O backend via API (CAPI server-side vai usar)
   *
   * Com o mesmo event_id nos dois lugares, a Meta sabe que são
   * o mesmo evento e conta apenas uma conversão.
   */
  var eventId = crypto.randomUUID();

  // Push 1 — Meta Pixel
  window.dataLayer.push({
    event: 'Purchase',
    content_ids: [produto.id],
    content_type: 'product',
    value: produto.preco,
    currency: 'BRL',
    num_items: 1,
    transaction_id: produto.idTransacao,
    payment_method: produto.metodoPagamento,
    event_id: eventId,
  });

  // Push 2 — GA4 Enhanced Ecommerce
  // Limpar ecommerce anterior (evita contaminação de dados entre eventos)
  window.dataLayer.push({ ecommerce: null });
  window.dataLayer.push({
    event: 'purchase',
    ecommerce: {
      transaction_id: produto.idTransacao,
      value: produto.preco,
      currency: 'BRL',
      payment_type: produto.metodoPagamento,
      items: [{
        item_id: produto.id,
        item_name: produto.nome,
        price: produto.preco,
        quantity: 1,
        item_category: 'digital',
      }],
    },
  });

  console.log('[Tracking] Purchase disparado. event_id:', eventId);

  // Retorna o eventId para que você possa enviar ao backend
  return { eventId: eventId };
}

// ---------------------------------------------------------------------------
// EXEMPLOS DE USO
// ---------------------------------------------------------------------------

/**
 * EXEMPLO 1: Configurar usuário após login
 *
 * Chame esta função logo após confirmar o login do usuário.
 * Os dados ficarão disponíveis no dataLayer para os eventos seguintes.
 */
async function exemploLoginBemSucedido() {
  // Dados vieram do backend após autenticação
  await setUser({
    email: 'joao@exemplo.com.br',
    primeiroNome: 'João',
    sobrenome: 'Silva',
    telefone: '(11) 99999-9999',
    userId: 'usr_abc123xyz', // ID interno do sistema
  });

  trackCompleteRegistration({
    metodo: 'magic_code',
    nomeConteudo: 'login',
  });
}

/**
 * EXEMPLO 2: Ver produto ao carregar a página
 *
 * Geralmente chamado no evento DOMContentLoaded ou equivalente.
 */
function exemploVerProduto() {
  trackViewContent({
    id: 'kit-completo',        // placeholder — substitua pelo ID real
    nome: 'Kit Premium',       // placeholder — substitua pelo nome real
    preco: 47.90,
  });
}

/**
 * EXEMPLO 3: Clique no botão "Comprar agora"
 *
 * Use esta função no onclick do seu botão de compra.
 */
function exemploCliqueComprar() {
  trackInitiateCheckout({
    id: 'kit-completo',
    nome: 'Kit Premium',
    preco: 47.90,
  });
  // Após isso: abrir modal de checkout, redirecionar para página de pagamento, etc.
}

/**
 * EXEMPLO 4: Botão "Comprar agora" no HTML
 *
 * <button onclick="aoClicarComprar()">Comprar agora</button>
 *
 * Defina a função no escopo global para usar em atributos onclick:
 */
function aoClicarComprar() {
  trackInitiateCheckout({
    id: 'kit-completo',
    nome: 'Kit Premium',
    preco: 47.90,
  });
  // Mostrar checkout inline, redirecionar, etc.
}

/**
 * EXEMPLO 5: Fluxo completo de compra PIX
 *
 * Demonstra o fluxo completo: do checkout até a confirmação.
 * Na prática, etapas diferentes são chamadas em momentos diferentes.
 */
async function exemploFluxoCompletoPIX() {
  // Usuário escolheu PIX como pagamento
  trackAddPaymentInfo({
    id: 'kit-completo',
    nome: 'Kit Premium',
    preco: 47.90,
    metodoPagamento: 'PIX',
  });

  // ... usuário vê QR code e paga ...

  // Backend confirmou o pagamento via webhook
  var resultado = trackPurchase({
    id: 'kit-completo',
    nome: 'Kit Premium',
    preco: 47.90,
    metodoPagamento: 'PIX',
    idTransacao: 'PAY_abc123', // ID do gateway de pagamento
  });

  /**
   * CRÍTICO: envie o eventId para o backend.
   * O backend vai incluir este mesmo ID no request da CAPI,
   * permitindo que a Meta deduplique (evite contar duas vezes).
   */
  console.log('Enviar ao backend: event_id =', resultado.eventId);

  // Exemplo de como enviar ao backend:
  // await fetch('/api/registrar-conversao', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({
  //     pagamentoId: 'PAY_abc123',
  //     eventId: resultado.eventId,
  //   }),
  // });
}

// ---------------------------------------------------------------------------
// NOTA SOBRE CONFIGURAÇÃO NO GTM
// ---------------------------------------------------------------------------
/**
 * Para que estes eventos funcionem, configure no GTM:
 *
 * 1. VARIÁVEIS DE DATALAYER — crie uma variável para cada campo:
 *    - DLV - content_ids
 *    - DLV - value
 *    - DLV - currency
 *    - DLV - event_id
 *    - DLV - transaction_id
 *    - DLV - payment_method
 *    - DLV - user.email
 *    - DLV - user.fn
 *    - DLV - user.ln
 *    - DLV - user.phone
 *    - DLV - user.external_id
 *    - DLV - ecommerce         (objeto completo para GA4)
 *
 * 2. TRIGGERS — crie um trigger "Custom Event" para cada evento:
 *    - ViewContent
 *    - CompleteRegistration
 *    - InitiateCheckout
 *    - AddPaymentInfo
 *    - Purchase
 *
 * 3. TAGS:
 *    - Tag do Meta Pixel: use as variáveis DLV nos campos do evento
 *      Configure Advanced Matching com as variáveis de user.*
 *      Defina o Event ID com a variável DLV - event_id
 *    - Tag do GA4 Event: use a variável DLV - ecommerce para Enhanced Ecommerce
 *
 * Consulte a documentação do GTM para detalhes de configuração de cada tag.
 */
