// caligrafia.js — a tira de traçar do ritual de guardar.
//
// O site escolhe um haiku clássico (ver haiku.js) e o mostra em kanji
// "fantasma" (texto do sistema, vertical, cinza claríssimo — NÃO desenhado
// aqui; é o elemento-guia no DOM). Sobre ele, este canvas captura o traço do
// usuário com um pincel de tinta sumi. É desenho LIVRE: sem reconhecer texto,
// sem validar ordem de traço — meditativo, como os cadernos de shodō.
//
// NÃO é a simulação de fluido: é um mini-canvas de desenho 2D. Ao selar,
// captura-se SÓ o traço do usuário (o guia fantasma vive no DOM, então não
// entra na imagem), em PNG com fundo transparente.

// Calibração do pincel (frações da LARGURA do papel, p/ escalar com o tamanho).
const LARG_BASE = 0.03; // espessura de repouso do traço
const LARG_MIN = 0.012; // mais fino (gesto rápido)
const LARG_MAX = 0.042; // mais grosso (gesto lento/pousado)
const VEL_AFINA = 0.5; // o quanto a velocidade do gesto afina o traço
const COR_SUMI = '#1b1714'; // preto de tinta (levemente quente, não puro)
const LADO_CAPTURA = 512; // lado maior do PNG salvo

/** Desenha todos os traços (lista de {pts:[{x,y,w}]} em coords normalizadas
 *  0..1) num contexto de tamanho W×H. Usado ao vivo (redesenhar no desfazer)
 *  e na captura (offscreen). */
function desenharTracos(ctx, tracos, W, H) {
  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COR_SUMI;
  ctx.fillStyle = COR_SUMI;
  for (const t of tracos) {
    const pts = t.pts;
    if (pts.length === 1) {
      const p = pts[0];
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, (p.w * W) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      ctx.lineWidth = ((a.w + b.w) / 2) * W;
      ctx.beginPath();
      ctx.moveTo(a.x * W, a.y * H);
      ctx.lineTo(b.x * W, b.y * H);
      ctx.stroke();
    }
  }
}

/**
 * Instala a etapa de caligrafia sobre os elementos do DOM. Retorna
 * { abrir(haiku, reduz) } — abrir devolve uma Promise que resolve com o
 * dataURL PNG dos traços (ou null, se o usuário pular).
 *
 * els: { raiz, papel, guia, tinta(canvas), romaji, pt, autor,
 *        desfazer, limpar, pular, selar }
 */
export function instalarCaligrafia(els) {
  const ctx = els.tinta.getContext('2d');
  let tracos = [];
  let atual = null; // traço em andamento
  let ponteiro = null;
  let resolver = null;

  /** Ajusta a resolução interna do canvas ao seu tamanho na tela (nítido). */
  function dimensionar() {
    const r = els.tinta.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    els.tinta.width = Math.max(1, Math.round(r.width * dpr));
    els.tinta.height = Math.max(1, Math.round(r.height * dpr));
    redesenhar();
  }

  function redesenhar() {
    desenharTracos(ctx, tracos, els.tinta.width, els.tinta.height);
  }

  /** clientX/Y → ponto normalizado [0,1] no papel. */
  function ponto(e) {
    const r = els.tinta.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / Math.max(r.width, 1),
      y: (e.clientY - r.top) / Math.max(r.height, 1),
    };
  }

  /** Largura do traço pela velocidade (gesto rápido afina, lento engrossa). */
  function largura(p, anterior) {
    if (!anterior) return LARG_BASE;
    const d = Math.hypot(p.x - anterior.x, p.y - anterior.y);
    return Math.max(LARG_MIN, Math.min(LARG_MAX, LARG_BASE - d * VEL_AFINA));
  }

  els.tinta.addEventListener('pointerdown', (e) => {
    if (ponteiro !== null) return;
    ponteiro = e.pointerId;
    els.tinta.setPointerCapture(e.pointerId);
    const p = ponto(e);
    p.w = LARG_BASE;
    atual = { pts: [p] };
    tracos.push(atual);
    // ponto inicial (um pingo, caso seja só um toque)
    ctx.fillStyle = COR_SUMI;
    ctx.beginPath();
    ctx.arc(p.x * els.tinta.width, p.y * els.tinta.height, (p.w * els.tinta.width) / 2, 0, Math.PI * 2);
    ctx.fill();
  });

  els.tinta.addEventListener('pointermove', (e) => {
    if (e.pointerId !== ponteiro || !atual) return;
    const anterior = atual.pts[atual.pts.length - 1];
    const p = ponto(e);
    p.w = largura(p, anterior);
    atual.pts.push(p);
    // desenho incremental do novo segmento (barato; o redesenho total só no desfazer)
    ctx.strokeStyle = COR_SUMI;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = ((anterior.w + p.w) / 2) * els.tinta.width;
    ctx.beginPath();
    ctx.moveTo(anterior.x * els.tinta.width, anterior.y * els.tinta.height);
    ctx.lineTo(p.x * els.tinta.width, p.y * els.tinta.height);
    ctx.stroke();
  });

  function soltar(e) {
    if (e.pointerId !== ponteiro) return;
    ponteiro = null;
    atual = null;
  }
  els.tinta.addEventListener('pointerup', soltar);
  els.tinta.addEventListener('pointercancel', soltar);

  els.desfazer.addEventListener('click', () => {
    tracos.pop();
    redesenhar();
  });
  els.limpar.addEventListener('click', () => {
    tracos = [];
    redesenhar();
  });
  els.pular.addEventListener('click', () => finalizar(null));
  els.selar.addEventListener('click', () => finalizar(capturar()));

  /** Captura SÓ os traços (o guia fantasma é DOM, não entra) num PNG
   *  transparente de ~512px no lado maior. null se nada foi traçado. */
  function capturar() {
    if (!tracos.length) return null;
    const r = els.tinta.getBoundingClientRect();
    const aspecto = r.width / Math.max(r.height, 1);
    const H = aspecto >= 1 ? Math.round(LADO_CAPTURA / aspecto) : LADO_CAPTURA;
    const W = aspecto >= 1 ? LADO_CAPTURA : Math.round(LADO_CAPTURA * aspecto);
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    desenharTracos(off.getContext('2d'), tracos, W, H);
    return off.toDataURL('image/png');
  }

  function finalizar(resultado) {
    els.raiz.hidden = true;
    const r = resolver;
    resolver = null;
    if (r) r(resultado);
  }

  /** Abre a tira com o haiku escolhido e espera o usuário selar/pular. */
  function abrir(haiku) {
    els.guia.textContent = haiku.jp;
    els.romaji.textContent = haiku.romaji;
    els.pt.textContent = haiku.pt;
    els.autor.textContent = '— ' + haiku.autor;
    tracos = [];
    els.raiz.hidden = false;
    // dimensiona após o layout (o papel já tem tamanho).
    requestAnimationFrame(() => requestAnimationFrame(dimensionar));
    return new Promise((res) => {
      resolver = res;
    });
  }

  // Re-dimensiona se a janela mudar enquanto a tira está aberta.
  window.addEventListener('resize', () => {
    if (!els.raiz.hidden) dimensionar();
  });

  return { abrir };
}
