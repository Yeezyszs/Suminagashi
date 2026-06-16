// ukiyoe.js — o motor de pintura UKIYO-E (xilogravura), em Canvas 2D.
//
// É o OPOSTO da água: o suminagashi é soltar o controle (fluido, acaso); o
// ukiyo-e é CONTROLE — linha definida, áreas chapadas, contorno. Outro motor,
// outro mundo. Nada de WebGL aqui: é linha + preenchimento, leve.
//
// CAMADAS (como a xilogravura, impressa em chapas): a cor e os padrões vão
// POR BAIXO; o contorno preto POR CIMA — a linha sempre "fecha" o desenho.
//   compor() = washi → camada BAIXO (cor + padrões) → camada LINHA (sumi).
// Cada gesto vira uma "operação" na pilha (p/ o desfazer): desfazer remove a
// última e redesenha as camadas a partir das que sobraram.
//
// Três pincéis (cada um muda o GESTO e o que dá para criar):
//   - contorno     : a LINHA de tinta sumi, espessura modulada pela velocidade
//   - preenchimento: áreas de COR chapada (sem gradiente)
//   - padrao       : a TEXTURA — carimba motivos estilizados (espuma, chuva)

// ---------------------------------------------------------------------------
// Calibração (ajustar no tato) — tudo em px de CSS (escalado por dpr no draw)
// ---------------------------------------------------------------------------

// Contorno (a alma): espessura MODULADA pela velocidade (lento/pressão =
// grosso, rápido = fino), como o pincel japonês.
const LINHA_MAX = 16.0; // mais grossa (gesto lento/pousado)
const LINHA_MIN = 2.5; // mais fina (gesto rápido)
const LINHA_VEL_REF = 1500; // px/s em que o traço afina até o mínimo
const LINHA_INICIO = 9.0; // espessura ao pousar (antes de medir velocidade)
const LINHA_SUAVIZA = 0.3; // suavização exponencial da espessura (0..1)
const LINHA_COR = '#17120d'; // sumi (preto levemente quente)
const TAPER_FIM = 0.3; // fração final do traço que afina até a ponta

// Preenchimento: pincel largo de cor chapada (opaco, sem gradiente).
const FILL_RAIO = 28; // raio do pincel de cor (px)

// Padrão: passo entre carimbos e tamanho do motivo.
const PADRAO_PASSO = 42; // distância entre motivos ao longo do gesto (px)
const PADRAO_TAM = 26; // tamanho-base do motivo (px)

// ---------------------------------------------------------------------------
// Washi (papel) procedural — tom envelhecido, fibras finas, leve vinheta.
// ---------------------------------------------------------------------------

function ruido(x, y) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

function desenharWashi(ctx, w, h) {
  // base: bege quente (não branco puro)
  ctx.fillStyle = '#e7ddc4';
  ctx.fillRect(0, 0, w, h);
  // manchas largas e suaves (envelhecimento)
  for (let i = 0; i < 60; i++) {
    const x = ruido(i, 1) * w;
    const y = ruido(i, 2) * h;
    const r = 40 + ruido(i, 3) * 160;
    const claro = ruido(i, 4) > 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + 0.05 * ruido(i, 5);
    g.addColorStop(0, claro ? `rgba(245,238,218,${a})` : `rgba(150,134,98,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  // fibras finas (linhas curtas)
  for (let i = 0; i < Math.round((w * h) / 1400); i++) {
    const x = ruido(i, 6) * w;
    const y = ruido(i, 7) * h;
    const l = 3 + ruido(i, 8) * 10;
    ctx.strokeStyle = `rgba(120,104,72,${0.04 + 0.05 * ruido(i, 9)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + l, y + (ruido(i, 10) - 0.5) * 3);
    ctx.stroke();
  }
  // vinheta sutil (bordas levemente mais escuras, como estampa antiga)
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(90,70,40,0.14)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------
// Pincéis (funções de desenho puras: recebem um ctx já escalado p/ CSS px)
// ---------------------------------------------------------------------------

/** CONTORNO: uma "fita" de largura variável construída deslocando a linha
 *  central pela normal — dá a linha modulada e suave do pincel japonês. */
function desenharContorno(ctx, pts) {
  if (!pts.length) return;
  if (pts.length < 3) {
    // traço curtinho: um pingo do tamanho da espessura
    const p = pts[0];
    ctx.fillStyle = LINHA_COR;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(LINHA_MIN, p.w) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const n = pts.length;
  const esq = [];
  const dir = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const nx = -ty; // normal
    const ny = tx;
    // afina nos últimos TAPER_FIM do traço (a ponta do pincel ao levantar)
    const frac = i / (n - 1);
    let taper = 1;
    if (frac > 1 - TAPER_FIM) taper = (1 - frac) / TAPER_FIM;
    taper = Math.max(0.06, taper);
    const meia = (pts[i].w * taper) / 2;
    esq.push({ x: pts[i].x + nx * meia, y: pts[i].y + ny * meia });
    dir.push({ x: pts[i].x - nx * meia, y: pts[i].y - ny * meia });
  }
  ctx.fillStyle = LINHA_COR;
  ctx.beginPath();
  ctx.moveTo(esq[0].x, esq[0].y);
  // lado esquerdo (curvas suaves pelos pontos médios)
  for (let i = 1; i < n - 1; i++) {
    const mx = (esq[i].x + esq[i + 1].x) / 2;
    const my = (esq[i].y + esq[i + 1].y) / 2;
    ctx.quadraticCurveTo(esq[i].x, esq[i].y, mx, my);
  }
  ctx.lineTo(dir[n - 1].x, dir[n - 1].y);
  // lado direito de volta
  for (let i = n - 2; i > 0; i--) {
    const mx = (dir[i].x + dir[i - 1].x) / 2;
    const my = (dir[i].y + dir[i - 1].y) / 2;
    ctx.quadraticCurveTo(dir[i].x, dir[i].y, mx, my);
  }
  ctx.closePath();
  ctx.fill();
}

/** PREENCHIMENTO: cor chapada opaca ao longo do gesto (pincel largo). */
function desenharPreenchimento(ctx, pts, cor) {
  ctx.fillStyle = cor;
  ctx.strokeStyle = cor;
  ctx.lineWidth = FILL_RAIO * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length < 2) {
    const p = pts[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, FILL_RAIO, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/** Uma "garra" de espuma (magatama/vírgula curvada) — o motivo-assinatura. */
function garraEspuma(ctx, x, y, ang, tam, cor) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = cor;
  ctx.beginPath();
  // garra de espuma (à la Hokusai): cabeça redonda e grossa que curva e afina
  // numa ponta fina, como um dedo de espuma.
  ctx.moveTo(-tam * 0.42, -tam * 0.1);
  ctx.bezierCurveTo(-tam * 0.5, -tam * 0.7, tam * 0.5, -tam * 0.75, tam * 0.46, -tam * 0.05);
  ctx.bezierCurveTo(tam * 0.44, tam * 0.5, tam * 0.16, tam * 1.05, -tam * 0.04, tam * 1.05);
  ctx.bezierCurveTo(tam * 0.18, tam * 0.55, tam * 0.12, tam * 0.1, -tam * 0.06, -tam * 0.02);
  ctx.bezierCurveTo(-tam * 0.22, -tam * 0.06, -tam * 0.34, tam * 0.02, -tam * 0.42, -tam * 0.1);
  ctx.fill();
  ctx.restore();
}

/** PADRÃO: carimba motivos estilizados ao longo do gesto. */
function desenharPadrao(ctx, pts, motivo, cor) {
  if (pts.length < 1) return;
  // distância acumulada → posiciona um motivo a cada PADRAO_PASSO
  let acc = 0;
  let prox = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc < prox) continue;
    prox = acc + PADRAO_PASSO;
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const semente = pts[i].x * 0.7 + pts[i].y * 0.3;
    const tam = PADRAO_TAM * (0.8 + 0.5 * (ruido(semente, i) || 0.5));
    if (motivo === 'chuva') {
      // linhas curtas de chuva, levemente diagonais
      ctx.strokeStyle = cor;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[i].x + Math.cos(ang + 1.4) * tam * 1.6, pts[i].y + Math.sin(ang + 1.4) * tam * 1.6);
      ctx.stroke();
    } else {
      // espuma: a garra orientada ao longo do gesto
      garraEspuma(ctx, pts[i].x, pts[i].y, ang - Math.PI / 2, tam, cor);
    }
  }
}

// ---------------------------------------------------------------------------
// O motor
// ---------------------------------------------------------------------------

/**
 * Cria o motor ukiyo-e sobre um <canvas>. Retorna a API de gesto e de obra.
 * @param {HTMLCanvasElement} canvas
 * @param {{aoInteragir?:function}} [opcoes]
 */
export function criarUkiyoe(canvas, opcoes = {}) {
  const ctx = canvas.getContext('2d');
  // camadas offscreen
  const washi = document.createElement('canvas');
  const baixo = document.createElement('canvas'); // cor + padrões
  const linha = document.createElement('canvas'); // contorno
  const cwashi = washi.getContext('2d');
  const cbaixo = baixo.getContext('2d');
  const clinha = linha.getContext('2d');

  let dpr = 1;
  let larguraCss = 1;
  let alturaCss = 1;

  // pilha de operações para o desfazer
  const ops = [];

  // gesto em andamento
  let ativo = null; // { tipo, cor, motivo, pts:[{x,y,w}] }
  let ponteiro = null;
  let ultimoT = 0;
  let velSuave = 0;
  let largSuave = LINHA_INICIO;

  // pincel atual
  let pincel = { tipo: 'contorno', cor: LINHA_COR, motivo: 'espuma' };

  function escala(c) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function redimensionar() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    larguraCss = canvas.clientWidth || window.innerWidth;
    alturaCss = canvas.clientHeight || window.innerHeight;
    for (const c of [canvas, washi, baixo, linha]) {
      c.width = Math.round(larguraCss * dpr);
      c.height = Math.round(alturaCss * dpr);
    }
    escala(cwashi);
    escala(cbaixo);
    escala(clinha);
    desenharWashi(cwashi, larguraCss, alturaCss);
    repintarCamadas();
    compor();
  }

  /** Redesenha as camadas baixo+linha a partir da pilha de operações. */
  function repintarCamadas() {
    cbaixo.clearRect(0, 0, larguraCss, alturaCss);
    clinha.clearRect(0, 0, larguraCss, alturaCss);
    for (const op of ops) aplicarOp(op);
  }

  function aplicarOp(op) {
    if (op.tipo === 'contorno') desenharContorno(clinha, op.pts);
    else if (op.tipo === 'preenchimento') desenharPreenchimento(cbaixo, op.pts, op.cor);
    else if (op.tipo === 'padrao') desenharPadrao(cbaixo, op.pts, op.motivo, op.cor);
  }

  /** Compõe a cena: washi → baixo → linha (e o gesto ativo por cima). */
  function compor() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(washi, 0, 0);
    ctx.drawImage(baixo, 0, 0);
    ctx.drawImage(linha, 0, 0);
    if (ativo) {
      escala(ctx);
      previewAtivo(ctx);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  function previewAtivo(c) {
    if (ativo.tipo === 'contorno') desenharContorno(c, ativo.pts);
    else if (ativo.tipo === 'preenchimento') desenharPreenchimento(c, ativo.pts, ativo.cor);
    else if (ativo.tipo === 'padrao') desenharPadrao(c, ativo.pts, ativo.motivo, ativo.cor);
  }

  // --- gesto ---------------------------------------------------------------

  function pontoLocal(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function inicio(e) {
    if (ponteiro !== null) return;
    ponteiro = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    if (opcoes.aoInteragir) opcoes.aoInteragir();
    const p = pontoLocal(e);
    velSuave = 0;
    largSuave = LINHA_INICIO;
    ultimoT = performance.now();
    p.w = largSuave;
    ativo = { tipo: pincel.tipo, cor: pincel.cor, motivo: pincel.motivo, pts: [p] };
    compor();
  }

  function mover(e) {
    if (e.pointerId !== ponteiro || !ativo) return;
    const p = pontoLocal(e);
    const ant = ativo.pts[ativo.pts.length - 1];
    const agora = performance.now();
    const dt = Math.max(1, agora - ultimoT);
    ultimoT = agora;
    const d = Math.hypot(p.x - ant.x, p.y - ant.y);
    if (d < 1.2) return; // ignora micro-tremor
    const vel = (d / dt) * 1000; // px/s
    velSuave = velSuave + (vel - velSuave) * 0.5;
    // espessura: lento/pressão = grosso, rápido = fino; suavizada p/ não tremer
    const t = Math.min(1, velSuave / LINHA_VEL_REF);
    const alvo = LINHA_MAX - t * (LINHA_MAX - LINHA_MIN);
    largSuave = largSuave + (alvo - largSuave) * LINHA_SUAVIZA;
    p.w = largSuave;
    ativo.pts.push(p);
    compor();
  }

  function fim(e) {
    if (e.pointerId !== ponteiro) return;
    ponteiro = null;
    if (ativo && ativo.pts.length) {
      ops.push(ativo);
      aplicarOp(ativo); // grava na camada permanente
    }
    ativo = null;
    compor();
  }

  canvas.addEventListener('pointerdown', inicio);
  canvas.addEventListener('pointermove', mover);
  canvas.addEventListener('pointerup', fim);
  canvas.addEventListener('pointercancel', fim);

  // --- API -----------------------------------------------------------------

  function definirPincel(tipo, cor, motivo) {
    pincel = { tipo, cor: cor || pincel.cor, motivo: motivo || pincel.motivo };
  }

  function desfazer() {
    if (!ops.length) return;
    ops.pop();
    repintarCamadas();
    compor();
  }

  function limpar() {
    ops.length = 0;
    repintarCamadas();
    compor();
  }

  /** A estampa final (washi + cor + linha) como dataURL, para guardar. */
  function capturar(tipo = 'image/jpeg', qualidade = 0.92) {
    return canvas.toDataURL(tipo, qualidade);
  }

  redimensionar();
  return {
    redimensionar,
    definirPincel,
    desfazer,
    limpar,
    capturar,
    compor,
    get vazio() {
      return ops.length === 0;
    },
  };
}
