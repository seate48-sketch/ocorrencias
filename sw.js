/* =========================================================
   SERVICE WORKER — Controle de Ausências
   Estratégia:
     - Shell do app (HTML, manifest): Network First com fallback para cache
     - Assets estáticos (ícones, fontes): Cache First
     - Requisições Supabase (API): Network Only (nunca cachear dados sensíveis)
========================================================= */

const CACHE_VERSION  = 'ausencias-v3';
const CACHE_STATIC   = `${CACHE_VERSION}-static`;

// Arquivos essenciais para funcionamento offline
const URLS_ESTATICAS = [
    './',
    './index.html',
    './manifest.json'
];

/* =========================================================
   INSTALL — Pré-cachear o shell da aplicação
========================================================= */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_STATIC)
            .then(cache => cache.addAll(URLS_ESTATICAS))
            .then(() => self.skipWaiting()) // Ativar imediatamente sem esperar aba fechar
    );
});

/* =========================================================
   ACTIVATE — Limpar caches antigos
========================================================= */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(name => name.startsWith('ausencias-') && name !== CACHE_STATIC)
                        .map(name => {
                            console.log('[SW] Removendo cache antigo:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => self.clients.claim()) // Assumir controle imediato de todas as abas
    );
});

/* =========================================================
   FETCH — Estratégias de cache por tipo de requisição
========================================================= */
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Ignorar requisições não-GET
    if (event.request.method !== 'GET') return;

    // Ignorar requisições ao Supabase (API de dados) — sempre vai para a rede
    if (url.hostname.includes('supabase.co') || url.hostname.includes('esm.sh')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Ignorar extensões de browser e chrome-extension
    if (!url.protocol.startsWith('http')) return;

    // Para o HTML principal: Network First (garante conteúdo atualizado)
    if (url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/')) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // Para ícones e assets estáticos: Cache First (performance)
    if (
        url.pathname.includes('/icons/') ||
        url.pathname.endsWith('.png')    ||
        url.pathname.endsWith('.jpg')    ||
        url.pathname.endsWith('.svg')    ||
        url.pathname.endsWith('.woff2')  ||
        url.pathname.endsWith('.woff')
    ) {
        event.respondWith(cacheFirst(event.request));
        return;
    }

    // Padrão: Stale While Revalidate (responde rápido, atualiza em segundo plano)
    event.respondWith(staleWhileRevalidate(event.request));
});

/* =========================================================
   ESTRATÉGIAS DE CACHE
========================================================= */

/**
 * Network First: tenta a rede; se falhar, usa o cache.
 * Ideal para o HTML principal, garantindo versão atualizada.
 */
async function networkFirst(request) {
    const cache = await caches.open(CACHE_STATIC);
    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch {
        const cached = await cache.match(request);
        return cached || new Response('Sem conexão e sem cache disponível.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}

/**
 * Cache First: usa o cache se disponível; caso contrário, busca na rede e armazena.
 * Ideal para assets estáticos (ícones, imagens).
 */
async function cacheFirst(request) {
    const cache  = await caches.open(CACHE_STATIC);
    const cached = await cache.match(request);
    if (cached) return cached;

    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch {
        return new Response('', { status: 503 });
    }
}

/**
 * Stale While Revalidate: responde com cache imediatamente e atualiza em background.
 * Bom equilíbrio entre performance e frescor dos dados.
 */
async function staleWhileRevalidate(request) {
    const cache  = await caches.open(CACHE_STATIC);
    const cached = await cache.match(request);

    const fetchPromise = fetch(request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    }).catch(() => null);

    return cached || await fetchPromise || new Response('', { status: 503 });
}

/* =========================================================
   MENSAGENS DO CLIENTE (ex.: forçar atualização)
========================================================= */
self.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
