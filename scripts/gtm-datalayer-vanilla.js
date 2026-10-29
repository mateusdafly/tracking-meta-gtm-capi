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
 *   // "7f32bc621b0f045c9ee21cd6a74bd09b3478062ab8f71e215ac1d201b702b0e9"
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
 * Deixa o telefone no formato que a META espera antes do hash:
 * só dígitos, com DDI, SEM o "+". Exemplos: 5511999999999, 5521999999999
 *
 * O "+" muda o hash: "+5511999999999" e "5511999999999" geram hashes
 * diferentes, e só o segundo bate com o da Meta.
 * (O Google é o contrário: quer o "+". Ver pii-hashing.md.)
 *
 * @param {string} telefone - número em qualquer formato
 * @param {string} ddi - código do país usado quando o número vem sem DDI (padrão: '55')
 * @returns {string} só dígitos, com DDI
 */
function normalizarTelefone(telefone, ddi = '55') {
  const veioComMais = telefone.trim().startsWith('+');
  let digitos = telefone.replace(/\D/g, '');

  // Veio com "+": o DDI já está no número
  if (veioComMais) return digitos;

  // Já tem DDI do Brasil (55 + DDD + número = 12 ou 13 dígitos)
  if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
    return digitos;
  }

  // Remove o 0 de discagem de longa distância
  if (digitos.startsWith('0')) digitos = digitos.slice(1);

  return ddi + digitos;
}

/**
 * lerCookiesMeta()
 * Lê os cookies _fbp e _fbc do browser.
 *
 * - _fbp: cookie gerado pelo Meta Pixel ao carregar na página
 *         Identifica o browser do visitante
 * - _fbc: gerado quando o visitante clicou em um anúncio Meta
 *         Formato: fb.1.{timestamp_ms}.{fbclid}
 *
 * Se o _fbc não existe (pixel bloqueado) mas a URL tem fbclid, monta o fbc
 * no formato certo. O fbclid cru não serve como fbc, e o valor nunca pode ter
 * maiúsculas/minúsculas alteradas. Para não perder o fbclid na navegação,
 * use scripts/captura-origem.js na primeira página.
 *
 * Esses valores melhoram a qualidade do match na Conversions API (CAPI).
 *
 * @returns {{ fbp: string|null, fbc: string|null }}
 */
function lerCookiesMeta() {
  const cookies = document.cookie.split('; ').reduce(function(acc, cookie) {
    const i = cookie.indexOf('=');
    if (i > 0) {
      acc[cookie.slice(0, i).trim()] = decodeURIComponent(cookie.slice(i + 1));
    }
    return acc;
  }, {});

  let fbc = cookies['_fbc'] || null;
  if (!fbc) {
    const fbclid = new URLSearchParams(window.location.search).get('fbclid');
    if (fbclid) fbc = 'fb.1.' + Date.now() + '.' + fbclid;
  }

  return {
    fbp: cookies['_fbp'] || null,
    fbc: fbc,
  };
}

/**
 * novoCheckoutId()
 * Gera o ID do checkout. Chame UMA vez quando o checkout abrir, guarde,
 * mande ao backend no POST que cria o pagamento e passe o mesmo valor como
 * `eventId` em InitiateCheckout, AddPaymentInfo e Purchase.
 */
function novoCheckoutId() {
  return crypto.randomUUID();
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
 * @param {string} dadosUsuario.userId      - ID único no sistema (hasheado, igual ao backend)
 */
async function setUser(dadosUsuario) {
  const telefonePadronizado = normalizarTelefone(dadosUsuario.telefone);
  const cookiesMeta = lerCookiesMeta();

  // Hasheia todos os dados pessoais em paralelo para performance
  const [emailHash, fnHash, lnHash, phoneHash, userIdHash] = await Promise.all([
    sha256Hash(dadosUsuario.email),
    sha256Hash(dadosUsuario.primeiroNome),
    sha256Hash(dadosUsuario.sobrenome),
    sha256Hash(telefonePadronizado),
    sha256Hash(String(dadosUsuario.userId)),
  ]);

  const objetoUser = {
    email: emailHash,
    fn: fnHash,
    ln: lnHash,
    phone: phoneHash,
    external_id: userIdHash, // mesmo hash que o backend manda na CAPI
  };

  // Adiciona cookies do Meta Pixel se disponíveis
  if (cookiesMeta.fbp) objetoUser.fbp = cookiesMeta.fbp;
  if (cookiesMeta.fbc) objetoUser.fbc = cookiesMeta.fbc;

  // event 'user_identified' dispara a tag de Advanced Matching (ver gtm-setup.md)
  window.dataLayer.push({ event: 'user_identified', user: objetoUser });
  console.log('[Tracking] Usuário setado no dataLayer');
}

// ---------------------------------------------------------------------------
// EVENTOS DO FUNIL
// ---------------------------------------------------------------------------

/**
 * trackLead(idLead)
 * Dispara o evento de formulário de contato enviado.
 *
 * Chame DEPOIS que o backend respondeu com o ID do lead, para usar o mesmo
 * event_id que o backend manda na CAPI: 'lead_' + idLead.
 *
 * Envia dois pushes:
 *   1. Meta Pixel: event='Lead'
 *   2. GA4:        event='generate_lead'
 *
 * @param {string} idLead - ID do lead devolvido pelo backend
 */
function trackLead(idLead) {
  window.dataLayer.push({
    event: 'Lead',
    event_id: 'lead_' + idLead,
  });

  window.dataLayer.push({
    event: 'generate_lead',
  });

  console.log('[Tracking] Lead disparado:', idLead);
}

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
 * @param {string} produto.id     - ID único do produto (ex: 'produto-exemplo')
 * @param {string} produto.nome   - nome do produto
 * @param {number} produto.preco  - preço em reais (ex: 197.00)
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
 * @param {string} produto.eventId - checkoutId (novoCheckoutId()), o mesmo que vai ao backend
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
    event_id: produto.eventId || crypto.randomUUID(),
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
 * @param {string} produto.eventId         - checkoutId, o mesmo do InitiateCheckout
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
    event_id: produto.eventId || crypto.randomUUID(),
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
 *   Esta função NÃO gera ID. Ela usa o checkoutId criado quando o checkout
 *   abriu (novoCheckoutId()) e que o backend já salvou no banco junto com o
 *   pagamento. O webhook do backend manda o Purchase pela CAPI com esse mesmo
 *   ID, e a Meta conta uma compra só. Se o navegador gerasse um ID novo aqui,
 *   a Meta contaria duas.
 *
 *   Exemplo de fluxo:
 *     var checkoutId = novoCheckoutId();              // checkout abriu
 *     await fetch('/api/checkout', { method: 'POST',
 *       body: JSON.stringify({ checkoutId: checkoutId, ... }) });
 *     // ... pagamento confirmado ...
 *     trackPurchase({ ..., eventId: checkoutId });
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
 * @param {string} produto.eventId         - checkoutId salvo no backend (obrigatório)
 * @returns {{ eventId: string }} o event_id usado no push
 */
function trackPurchase(produto) {
  if (!produto.eventId) {
    // Sem o ID do backend, o pixel e a CAPI contariam a venda duas vezes
    console.error('[Tracking] trackPurchase sem eventId: passe o checkoutId salvo no backend.');
    return { eventId: null };
  }
  var eventId = produto.eventId;

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
    id: 'produto-exemplo',        // placeholder — substitua pelo ID real
    nome: 'Produto Exemplo',       // placeholder — substitua pelo nome real
    preco: 197.00,
  });
}

/**
 * EXEMPLO 3: Clique no botão "Comprar agora"
 *
 * Use esta função no onclick do seu botão de compra.
 */
function exemploCliqueComprar() {
  trackInitiateCheckout({
    id: 'produto-exemplo',
    nome: 'Produto Exemplo',
    preco: 197.00,
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
    id: 'produto-exemplo',
    nome: 'Produto Exemplo',
    preco: 197.00,
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
  // Checkout abriu: um ID só para o checkout inteiro
  var checkoutId = novoCheckoutId();
  // await fetch('/api/checkout', { method: 'POST',
  //   body: JSON.stringify({ checkoutId: checkoutId, produto: 'produto-exemplo' }) });

  // Usuário escolheu PIX como pagamento
  trackAddPaymentInfo({
    eventId: checkoutId,
    id: 'produto-exemplo',
    nome: 'Produto Exemplo',
    preco: 197.00,
    metodoPagamento: 'PIX',
  });

  // ... usuário vê QR code e paga ...

  // Polling mostrou que o backend confirmou o pagamento
  trackPurchase({
    eventId: checkoutId, // o mesmo ID que o webhook usa na CAPI
    id: 'produto-exemplo',
    nome: 'Produto Exemplo',
    preco: 197.00,
    metodoPagamento: 'PIX',
    idTransacao: 'PAY_abc123', // ID do gateway de pagamento
  });
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
 *    - user_identified (Advanced Matching)
 *    - ViewContent
 *    - CompleteRegistration
 *    - InitiateCheckout
 *    - AddPaymentInfo
 *    - Purchase
 *
 * 3. TAGS:
 *    - Tag do Meta Pixel: use as variáveis DLV nos campos do evento
 *      Defina o Event ID com a variável DLV - event_id (4º argumento do fbq)
 *    - Tag "Meta - Advanced Matching" no trigger user_identified (ver gtm-setup.md)
 *    - Tag do GA4 Event: marque "Enviar dados de comércio eletrônico" com origem
 *      "Camada de dados" (lê o objeto ecommerce sozinho)
 *
 * Consulte a documentação do GTM para detalhes de configuração de cada tag.
 */
