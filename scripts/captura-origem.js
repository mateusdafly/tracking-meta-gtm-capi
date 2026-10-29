/**
 * captura-origem.js
 *
 * Guarda de onde o visitante veio (UTMs + IDs de clique) e entrega esses dados
 * para o formulário e para o WhatsApp, para que cheguem ao CRM junto com o lead.
 *
 * Por que existe: o fbclid e o gclid só aparecem na URL da PRIMEIRA página.
 * Na navegação seguinte eles somem. Se o lead preenche o formulário duas páginas
 * depois, ou volta dois dias depois, sem este script o CRM recebe o lead sem
 * nenhum rastro do anúncio, e a venda não tem como voltar para a campanha.
 *
 * O que ele guarda:
 *   - UTMs (utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id)
 *     → servem para o SEU relatório no CRM (venda por campanha, conjunto, anúncio)
 *   - fbclid (Meta) e gclid/gbraid/wbraid (Google)
 *     → são eles que fazem o Meta e o Google acharem o anúncio certo na volta
 *   - fbc já montado no formato fb.1.{timestamp_ms}.{fbclid}
 *   - landing page, referrer e quando foi capturado
 *
 * Regras:
 *   - Visita com UTM ou ID de clique vira o "último toque" (sobrescreve o anterior).
 *   - Visita sem nada (direto, orgânico) NÃO apaga o último toque.
 *   - O primeiro toque é gravado uma vez só (campos ft_*).
 *   - Validade: 90 dias (a janela máxima de conversão do Google).
 *
 * Como usar:
 *   1. Carregue em TODAS as páginas, o mais cedo possível (no <head> ou numa tag
 *      HTML Personalizado do GTM com acionador "Inicialização - Todas as páginas").
 *   2. No formulário, crie campos ocultos com os nomes de CAMPOS abaixo
 *      (ex: <input type="hidden" name="utm_campaign">). O script preenche sozinho
 *      quando o visitante interage com o formulário e no envio.
 *   3. Links de WhatsApp com o atributo data-origem ganham um código na mensagem
 *      (ex: "ref: K7Q2MX") e, se CONFIG.endpointWhatsapp estiver definido, a origem
 *      é enviada para o seu backend com esse código. O CRM casa o código quando a
 *      mensagem chega.
 *   4. LGPD: se o seu site pede consentimento antes de rastrear, defina
 *      window.ORIGEM_AGUARDAR_CONSENTIMENTO = true antes de carregar este script
 *      e chame window.origemRastreio.iniciar() depois do aceite.
 *
 * Nenhuma dependência. Nenhum dado pessoal é guardado aqui: só parâmetros de URL.
 */
(function () {
  'use strict';

  var CONFIG = {
    chave: 'origem_rastreio',
    diasValidade: 90,
    // URL do seu backend que recebe { codigo, origem } quando alguém clica no WhatsApp.
    // Deixe null se o lead sempre passa por um formulário antes.
    endpointWhatsapp: null,
  };

  var PARAMS_URL = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
    'fbclid', 'gclid', 'gbraid', 'wbraid'];

  // Nomes dos campos ocultos do formulário (e dos campos personalizados no CRM)
  var CAMPOS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
    'fbclid', 'fbc', 'fbp', 'gclid', 'gbraid', 'wbraid',
    'landing_page', 'referrer', 'origem_capturada_em',
    'ft_utm_source', 'ft_utm_medium', 'ft_utm_campaign', 'ft_capturada_em',
    'origem_codigo'];

  function ler() {
    try {
      var bruto = localStorage.getItem(CONFIG.chave);
      if (!bruto) bruto = lerCookie(CONFIG.chave);
      if (!bruto) return {};
      var dados = JSON.parse(bruto);
      var expira = dados._expira || 0;
      return Date.now() < expira ? dados : {};
    } catch (e) {
      return {};
    }
  }

  function gravar(dados) {
    dados._expira = Date.now() + CONFIG.diasValidade * 24 * 60 * 60 * 1000;
    var json = JSON.stringify(dados);
    try { localStorage.setItem(CONFIG.chave, json); } catch (e) { /* modo privado */ }
    // Cookie de 1ª parte: deixa o backend ler a origem direto da requisição
    try {
      document.cookie = CONFIG.chave + '=' + encodeURIComponent(json) +
        '; max-age=' + (CONFIG.diasValidade * 24 * 60 * 60) + '; path=/; SameSite=Lax';
    } catch (e) { /* sem cookie */ }
  }

  function lerCookie(nome) {
    var partes = document.cookie ? document.cookie.split('; ') : [];
    for (var i = 0; i < partes.length; i++) {
      var p = partes[i].indexOf('=');
      if (p > 0 && partes[i].slice(0, p) === nome) return decodeURIComponent(partes[i].slice(p + 1));
    }
    return null;
  }

  function codigoCurto() {
    var letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I para não confundir
    var out = '';
    var bytes = crypto.getRandomValues(new Uint8Array(6));
    for (var i = 0; i < bytes.length; i++) out += letras[bytes[i] % letras.length];
    return out;
  }

  function capturar() {
    var url = new URLSearchParams(window.location.search);
    var toque = {};
    var temAlgo = false;
    PARAMS_URL.forEach(function (k) {
      var v = url.get(k);
      if (v) { toque[k] = v; temAlgo = true; } // valor exatamente como veio: click IDs diferenciam maiúsculas
    });

    var dados = ler();
    if (!dados.origem_codigo) dados.origem_codigo = codigoCurto();

    if (temAlgo) {
      var agora = Date.now();
      // Último toque: limpa o anterior para não misturar UTM de uma campanha com clique de outra
      PARAMS_URL.concat(['fbc', 'landing_page', 'referrer', 'origem_capturada_em']).forEach(function (k) {
        delete dados[k];
      });
      Object.keys(toque).forEach(function (k) { dados[k] = toque[k]; });
      if (toque.fbclid) dados.fbc = 'fb.1.' + agora + '.' + toque.fbclid;
      dados.landing_page = window.location.origin + window.location.pathname;
      dados.referrer = document.referrer || '';
      dados.origem_capturada_em = new Date(agora).toISOString();

      if (!dados.ft_capturada_em) {
        dados.ft_utm_source = toque.utm_source || '';
        dados.ft_utm_medium = toque.utm_medium || '';
        dados.ft_utm_campaign = toque.utm_campaign || '';
        dados.ft_capturada_em = dados.origem_capturada_em;
      }
    }

    gravar(dados);
    return dados;
  }

  /** Origem atual, com fbp/fbc do pixel quando existirem (são mais precisos). */
  function obter() {
    var dados = ler();
    var fbp = lerCookie('_fbp');
    var fbcPixel = lerCookie('_fbc');
    if (fbp) dados.fbp = fbp;
    if (fbcPixel) dados.fbc = fbcPixel;
    delete dados._expira;
    return dados;
  }

  function preencher(form) {
    var dados = obter();
    CAMPOS.forEach(function (nome) {
      var campo = form.querySelector('[name="' + nome + '"]');
      if (campo && dados[nome] !== undefined && !campo.value) campo.value = dados[nome];
    });
  }

  function decorarWhatsapp(link) {
    var dados = obter();
    try {
      var url = new URL(link.href);
      var texto = url.searchParams.get('text') || '';
      if (texto.indexOf('ref: ' + dados.origem_codigo) === -1) {
        url.searchParams.set('text', (texto ? texto + ' ' : '') + '(ref: ' + dados.origem_codigo + ')');
        link.href = url.toString();
      }
    } catch (e) { /* href inválido */ }

    if (CONFIG.endpointWhatsapp && navigator.sendBeacon) {
      navigator.sendBeacon(CONFIG.endpointWhatsapp, new Blob(
        [JSON.stringify({ codigo: dados.origem_codigo, origem: dados })],
        { type: 'application/json' }
      ));
    }
  }

  function ligarEventos() {
    // Preenche no primeiro contato com o formulário e de novo no envio
    // (cobre formulários que aparecem depois, em modal ou SPA)
    document.addEventListener('focusin', function (e) {
      var form = e.target && e.target.closest && e.target.closest('form');
      if (form) preencher(form);
    }, true);
    document.addEventListener('submit', function (e) {
      if (e.target && e.target.tagName === 'FORM') preencher(e.target);
    }, true);
    document.addEventListener('click', function (e) {
      var link = e.target && e.target.closest && e.target.closest('a[data-origem]');
      if (link && /wa\.me|api\.whatsapp\.com/.test(link.href)) decorarWhatsapp(link);
    }, true);
  }

  var iniciado = false;
  function iniciar() {
    if (iniciado) return obter();
    iniciado = true;
    capturar();
    ligarEventos();
    return obter();
  }

  window.origemRastreio = {
    iniciar: iniciar,
    obter: obter,
    preencher: preencher,
    campos: CAMPOS.slice(),
  };

  if (!window.ORIGEM_AGUARDAR_CONSENTIMENTO) iniciar();
})();
