/**
 * debug-datalayer.js — Inspecionar o dataLayer em tempo real no console do browser
 *
 * USO: Cole este código no Console do DevTools (F12 > Console) e navegue pelo site.
 * Cada push ao dataLayer será logado com destaque visual.
 *
 * Comandos disponíveis depois de colar:
 *   dlDebug.history()    — ver todos os pushes desde que a página carregou
 *   dlDebug.events()     — ver apenas os eventos (tem campo "event")
 *   dlDebug.last()       — ver o último push
 *   dlDebug.find('Purchase') — filtrar pushes por nome de evento
 *   dlDebug.cookies()    — ver cookies Meta (_fbp, _fbc)
 *   dlDebug.stop()       — parar de interceptar novos pushes
 */

(function() {
  'use strict';

  const COLORS = {
    Meta: '#1877F2',       // azul Meta
    GA4: '#E37400',        // laranja Google
    ecommerce: '#34A853',  // verde
    user: '#9C27B0',       // roxo (dados de usuário)
    default: '#666',
  };

  function getEventColor(push) {
    if (!push.event) return COLORS.default;
    const e = push.event;
    // Meta: PascalCase
    if (/^[A-Z]/.test(e)) return COLORS.Meta;
    // GA4: snake_case
    if (/^[a-z]/.test(e)) return COLORS.GA4;
    return COLORS.default;
  }

  // Inicializar dataLayer se não existir
  window.dataLayer = window.dataLayer || [];

  // Guardar histórico de pushes
  const _history = [...window.dataLayer]; // pushes que já aconteceram

  // Interceptar novos pushes
  const _originalPush = Array.prototype.push;
  let _intercepting = true;

  window.dataLayer.push = function(...args) {
    if (_intercepting) {
      args.forEach(item => {
        if (item && typeof item === 'object') {
          _history.push({ ...item, _timestamp: new Date().toISOString() });
          logPush(item);
        }
      });
    }
    return _originalPush.apply(this, args);
  };

  function logPush(item) {
    const event = item.event || '(sem event)';
    const color = getEventColor(item);
    const isEcommerce = 'ecommerce' in item;
    const hasUser = 'user' in item;
    const hasEventId = 'event_id' in item;

    // Título com ícones indicadores
    const icons = [
      isEcommerce ? '🛒' : '',
      hasUser ? '👤' : '',
      hasEventId ? '🔑' : '',
    ].filter(Boolean).join('');

    console.groupCollapsed(
      `%c[dataLayer] %c${event} %c${icons}`,
      'color: #888; font-size: 11px',
      `color: ${color}; font-weight: bold; font-size: 12px`,
      'color: #888; font-size: 11px'
    );

    // Dados principais
    const display = { ...item };
    delete display._timestamp;

    // Destacar campos importantes
    if (item.event_id) {
      console.log('%cevent_id (dedup CAPI):', 'color: #E91E63; font-weight: bold', item.event_id);
    }
    if (item.user) {
      console.log('%cuser (PII hasheado):', 'color: #9C27B0; font-weight: bold', item.user);
    }
    if (item.ecommerce) {
      console.log('%cecommerce:', 'color: #34A853; font-weight: bold', item.ecommerce);
    }

    // Resto dos campos
    const rest = Object.fromEntries(
      Object.entries(display).filter(([k]) => !['event', 'event_id', 'user', 'ecommerce'].includes(k))
    );
    if (Object.keys(rest).length > 0) {
      console.log('campos:', rest);
    }

    console.groupEnd();
  }

  // API pública
  window.dlDebug = {
    history: () => {
      console.table(_history.map(h => ({
        event: h.event || '—',
        event_id: h.event_id || '—',
        value: h.value || h.ecommerce?.value || '—',
        _timestamp: h._timestamp,
      })));
      return _history;
    },

    events: () => {
      const events = _history.filter(h => h.event);
      console.table(events.map(h => ({
        event: h.event,
        event_id: h.event_id || '—',
        value: h.value || h.ecommerce?.value || '—',
        hasUser: !!h.user,
        hasEcommerce: !!h.ecommerce,
        _timestamp: h._timestamp,
      })));
      return events;
    },

    last: () => {
      const last = _history[_history.length - 1];
      console.log('Último push:', last);
      return last;
    },

    find: (eventName) => {
      const found = _history.filter(h => h.event === eventName);
      console.log(`Pushes com event="${eventName}":`, found);
      return found;
    },

    cookies: () => {
      const cookies = {};
      document.cookie.split(';').forEach(c => {
        const [k, ...v] = c.trim().split('=');
        if (k?.startsWith('_fb')) cookies[k] = v.join('=');
      });
      if (Object.keys(cookies).length === 0) {
        console.warn('Nenhum cookie Meta encontrado (_fbp, _fbc). Ad blocker ativo? Safari ITP?');
      } else {
        console.log('Cookies Meta:', cookies);
      }
      return cookies;
    },

    stop: () => {
      _intercepting = false;
      console.log('[dlDebug] Interceptação parada. Recarregue a página para reiniciar.');
    },

    raw: () => window.dataLayer,
  };

  console.log(
    '%c[dlDebug] Interceptando dataLayer. Comandos: dlDebug.history() | dlDebug.events() | dlDebug.last() | dlDebug.find(event) | dlDebug.cookies() | dlDebug.stop()',
    'background: #1877F2; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px'
  );

  // Logar pushes que já existiam no dataLayer antes da interceptação
  if (_history.length > 0) {
    console.log(`[dlDebug] ${_history.length} pushes anteriores encontrados. Use dlDebug.history() para ver.`);
  }
})();
