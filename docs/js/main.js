// main.js — o tokonoma: orquestra a água, a luz, os estados e a estante.
//
// Três estados, costurados por transições suaves:
//   ocioso   — só a água viva respira; título vertical + aba da estante.
//   pintando — ao tocar, as ferramentas emergem; recuam após inatividade.
//   estante  — puxada pela aba; expõe UMA obra por vez (tokonoma).
//
// E um único momento "alto": a SEQUÊNCIA DE GUARDAR — assentar, selar com
// o hanko vermelho, enrolar a obra em pergaminho, recolher para a estante.

import { mulberry32, entre } from './prng.js';
import { criarFluido } from './fluido.js';
import { instalarInput } from './input.js';
import {
  cicloDeLuz,
  extrairTomFundacao,
  comporAtmosfera,
  corDaAtmosfera,
} from './luz.js';
import { gerarNome, horaFormatada } from './estante.js';

// ---------------------------------------------------------------------------
// Constantes (chutes iniciais agrupados; calibrar no tato)
// ---------------------------------------------------------------------------

const COR_PAPEL = '#EFE9DC'; // washi (a superfície da água)

// 10 tintas + água. Escolhidas para misturar bem em densidade óptica
// (Beer-Lambert): amarelo-ouro + azul-céu → verde, etc.
const PALETA = [
  { nome: 'sumi', cor: '#1C1C1C' },
  { nome: 'índigo', cor: '#1F3A5F' },
  { nome: 'vermelhão', cor: '#C8401F' },
  { nome: 'verde-pinho', cor: '#3E5C43' },
  { nome: 'amarelo-ouro', cor: '#D4A937' },
  { nome: 'azul-céu', cor: '#7BA7C7' },
  { nome: 'rosa', cor: '#D08CA0' },
  { nome: 'verde-claro', cor: '#9CB97E' },
  { nome: 'ameixa', cor: '#7A5577' },
  { nome: 'terracota', cor: '#C07A50' },
];

const CHAVE_PALETA = 'paleta.v1';
const CHAVE_FUNDACAO = 'fundacao.v1'; // viés de tom (camada 2 da luz)
const CHAVE_ESTANTE = 'estante.v1'; // array de obras guardadas

const DURACAO_LONGPRESS = 450; // long-press no swatch → editor de cor

const RAIO_MINIMO = 18;
const RAIO_MAXIMO = 48;
const RAIO_ESTILETE = 70;

const DURACAO_LAVAR = 600; // fade do lavar (ms)
const DT_MAXIMO = 1 / 30; // teto do passo da física

const RECUO_MS = 4000; // inatividade que faz as ferramentas recuarem

// Ritual de entrada
const GESTOS_MINIMOS = 3;
const INATIVIDADE_ASSENTAR = 10000; // 10s parado → a obra assenta
const DURACAO_ASSENTAMENTO = 3000; // a água se aquieta ao longo de 3s
const TEXTO_CONVITE = 'pinte. esta sala vai nascer das suas cores.';

// Sequência de guardar (durações de cada etapa, ms)
const GUARDAR_ASSENTAR = 1000;
const GUARDAR_SELAR = 600;
const GUARDAR_ENROLAR = 1200;
const GUARDAR_RECOLHER = 800;

// Lado maior (px) da imagem guardada por obra. Serve a DOIS usos: a
// vitrine da estante (exibida reduzida) e o download. Não dá para
// re-renderizar uma obra guardada em alta resolução depois — a simulação
// não guarda estado por obra, só esta imagem —, então capturamos aqui num
// tamanho bom para baixar/compartilhar. JPEG 0.85 ≈ 100–200KB por obra;
// localStorage (~5MB) comporta dezenas antes da cota apertar (ver
// salvarEstante, que descarta a obra mais antiga se faltar espaço).
const LARGURA_OBRA = 1024;

// ---------------------------------------------------------------------------
// localStorage com rede de proteção (modo anônimo restrito não derruba o
// site — o recurso passa a valer só para a sessão, sem erro no console).
// ---------------------------------------------------------------------------

function lerArmazenado(chave) {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}

function gravarArmazenado(chave, valor) {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* sem armazenamento: vale só na sessão */
  }
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

/** '#RRGGBB' → [r, g, b] em [0, 1] (formato que os shaders esperam). */
function hexParaRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

const rng = mulberry32(Date.now());

const canvas = document.getElementById('agua');
let fluido;
try {
  fluido = criarFluido(canvas, hexParaRgb(COR_PAPEL));
} catch (e) {
  document.getElementById('convite').textContent =
    'este navegador não suporta a simulação de água (WebGL2)';
  throw e;
}

const reduzMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');
const corpo = document.body;
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

// Cores personalizadas sobrepostas à paleta padrão.
const coresPersonalizadas = lerArmazenado(CHAVE_PALETA) || {};
const corDoSwatch = (i) => coresPersonalizadas[i] || PALETA[i].cor;

// Seleção atual: índice da PALETA, ou 'agua'.
let selecao = 0;

// --- estado geral -----------------------------------------------------------

let estanteAberta = false;
let guardando = false; // sequência de guardar em andamento
let emRitual = false;

// Ondulação ambiente: suavizada por um alvo (assentar/retomar a água).
let ondulacaoAtual = 1;
let ondulacaoAlvo = 1;

let inicioLavagem = null;
let quadroAnterior = null;
let timerRecuo = null;

// Ritual: telemetria mínima e relógio de inatividade.
let ultimaInteracao = performance.now();
let gestosNoRitual = 0;
let assentandoRitual = false;
let inicioAssentRitual = 0;

// Estante de obras guardadas.
let obras = lerArmazenado(CHAVE_ESTANTE) || [];
let focoEstante = 0;

// --- atmosfera (sistema de luz) ---------------------------------------------

let tomFundacao = lerArmazenado(CHAVE_FUNDACAO); // null = sala sem alma
const overlayAtmosfera = document.getElementById('atmosfera');
const horaForcada = new URLSearchParams(location.search).get('hora');

function agoraParaLuz() {
  if (horaForcada === null) return new Date();
  const [hh, mm] = horaForcada.split(':');
  const d = new Date();
  d.setHours(Number(hh) || 0, Number(mm) || 0, 0, 0);
  return d;
}

function atualizarAtmosfera() {
  const atm = comporAtmosfera(cicloDeLuz(agoraParaLuz()), tomFundacao);
  const { centro, borda } = corDaAtmosfera(atm);
  overlayAtmosfera.style.setProperty('--atm-centro', centro);
  overlayAtmosfera.style.setProperty('--atm-borda', borda);
}

// ---------------------------------------------------------------------------
// Estados ocioso ⇄ pintando
// ---------------------------------------------------------------------------

function emergirFerramentas() {
  if (estanteAberta || guardando) return;
  corpo.classList.add('pintando');
  corpo.classList.remove('ocioso');
}

function recolherFerramentas() {
  corpo.classList.remove('pintando');
  corpo.classList.add('ocioso');
}

/** Qualquer gesto na água: acorda as ferramentas, rearma o recuo e
 *  alimenta o relógio de inatividade do ritual (cancelando o assentamento
 *  se ele já tiver começado). */
function marcarInteracao() {
  ultimaInteracao = performance.now();
  emergirFerramentas();
  clearTimeout(timerRecuo);
  timerRecuo = setTimeout(recolherFerramentas, RECUO_MS);

  if (assentandoRitual) {
    assentandoRitual = false;
    ondulacaoAlvo = 1;
  }
  esconderConvite();
}

canvas.addEventListener('pointerdown', () => {
  if (!estanteAberta && !guardando) marcarInteracao();
});

// ---------------------------------------------------------------------------
// Gestos → fluido
// ---------------------------------------------------------------------------

const input = instalarInput(canvas, {
  aoPingar(x, y) {
    if (estanteAberta || guardando) return;
    const raio = entre(rng, RAIO_MINIMO, RAIO_MAXIMO);
    if (selecao === 'agua') fluido.pingarAgua(x, y, raio);
    else fluido.pingar(x, y, raio, hexParaRgb(corDoSwatch(selecao)));
    gestosNoRitual++;
    marcarInteracao();
  },
  aoArrastar(x, y, mx, my, velPx) {
    if (estanteAberta || guardando) return;
    fluido.mexer(x, y, mx, my, velPx, RAIO_ESTILETE);
    marcarInteracao();
  },
  aoSoltar() {
    // O momentum da própria água continua o movimento.
    gestosNoRitual++;
  },
});

// ---------------------------------------------------------------------------
// Loop de animação
// ---------------------------------------------------------------------------

function quadro(agora) {
  input.processarPendentes();

  if (quadroAnterior !== null) {
    const dt = Math.min((agora - quadroAnterior) / 1000, DT_MAXIMO);

    // Ritual: após gestos suficientes + inatividade, a obra assenta.
    if (emRitual && !assentandoRitual && !guardando) {
      if (gestosNoRitual >= GESTOS_MINIMOS && agora - ultimaInteracao > INATIVIDADE_ASSENTAR) {
        if (reduzMovimento.matches) {
          concluirRitual();
        } else {
          assentandoRitual = true;
          inicioAssentRitual = agora;
          ondulacaoAlvo = 0; // a água começa a se aquietar
          recolherFerramentas();
        }
      }
    }
    if (assentandoRitual && agora - inicioAssentRitual >= DURACAO_ASSENTAMENTO) {
      assentandoRitual = false;
      concluirRitual();
    }

    // Suaviza a ondulação em direção ao alvo (assentar/retomar).
    ondulacaoAtual += (ondulacaoAlvo - ondulacaoAtual) * Math.min(1, dt * 3.5);
    fluido.passo(dt, reduzMovimento.matches ? 0 : ondulacaoAtual);

    // Lavagem: decaimento suave até zerar a obra em DURACAO_LAVAR.
    if (inicioLavagem !== null) {
      const progresso = (agora - inicioLavagem) / DURACAO_LAVAR;
      if (progresso >= 1) {
        fluido.desbotar(1);
        inicioLavagem = null;
      } else {
        fluido.desbotar(1 - Math.pow(0.001, dt / (DURACAO_LAVAR / 1000)));
      }
    }
  }
  quadroAnterior = agora;

  fluido.exibir();
  requestAnimationFrame(quadro);
}

function lavar() {
  if (inicioLavagem !== null) return;
  if (reduzMovimento.matches) fluido.desbotar(1);
  else inicioLavagem = performance.now();
  // Lavar não conta como guardar nem zera a contagem do ritual; só rearma
  // o relógio de inatividade (senão a bacia recém-lavada assentaria vazia).
  ultimaInteracao = performance.now();
  clearTimeout(timerRecuo);
  timerRecuo = setTimeout(recolherFerramentas, RECUO_MS);
}

// ---------------------------------------------------------------------------
// A SEQUÊNCIA DE GUARDAR (o momento-assinatura)
// ---------------------------------------------------------------------------

const cenaGuardar = document.getElementById('cena-guardar');
const pergaminho = document.getElementById('pergaminho');
const pergaminhoImg = document.getElementById('pergaminho-img');
const hanko = document.getElementById('hanko');

/**
 * Coreografia de ~3–4s: assentar → selar (hanko vermelho) → enrolar em
 * pergaminho → recolher para a estante → água limpa. É o único momento
 * "alto" e o único vermelho do site. Com reduced-motion, colapsa para um
 * corte rápido com o selo aparecendo de relance.
 *
 * @param {boolean} ehFundacao - a primeira obra (vinda do ritual)
 */
async function guardar(ehFundacao = false) {
  if (guardando || obras === null) return;
  guardando = true;
  recolherFerramentas();
  clearTimeout(timerRecuo);

  const reduz = reduzMovimento.matches;

  // 1. Assentar: a água se aquieta.
  ondulacaoAlvo = 0;
  await dorme(reduz ? 0 : GUARDAR_ASSENTAR);

  // Captura a obra já assentada (cores finais; sem a atmosfera, que é só
  // overlay — a imagem guarda a pintura "crua").
  const captura = fluido.capturar(LARGURA_OBRA);
  const dataUrl = capturaParaDataUrl(captura);
  const tom = extrairTomFundacao(captura.pixels, captura.w, captura.h, hexParaRgb(COR_PAPEL));

  // 2. Selar: o hanko desce e carimba.
  baterHanko();
  await dorme(reduz ? 140 : GUARDAR_SELAR);

  // 3 + 4. Enrolar em pergaminho e recolher até a aba (só com animação).
  if (!reduz) await enrolarPergaminho(dataUrl);

  // Registra a obra na estante.
  registrarObra(dataUrl, tom.calidez, ehFundacao);

  // 5. Água limpa, cena escondida, volta ao ocioso.
  fluido.desbotar(1);
  esconderCenaGuardar();
  ondulacaoAlvo = 1;
  guardando = false;
  recolherFerramentas();
}

function baterHanko() {
  cenaGuardar.hidden = false;
  pergaminho.style.opacity = '0'; // o pergaminho só aparece ao enrolar
  hanko.classList.remove('bater');
  void hanko.offsetWidth; // reinicia a animação
  hanko.classList.add('bater');
}

/** Enrola a obra de baixo para cima (clip-path) e a desliza até a aba. */
async function enrolarPergaminho(dataUrl) {
  pergaminhoImg.src = dataUrl;
  pergaminho.style.transition = 'none';
  pergaminho.style.transform = 'none';
  pergaminho.style.opacity = '1';
  pergaminho.style.clipPath = 'inset(0 0 0 0)';
  void pergaminho.offsetWidth; // aplica o estado inicial antes de animar

  // Enrolar: a faixa visível encolhe de baixo para cima.
  pergaminho.style.transition = `clip-path ${GUARDAR_ENROLAR}ms ease-in, transform ${GUARDAR_ENROLAR}ms ease-in`;
  pergaminho.style.clipPath = 'inset(0 0 100% 0)';
  pergaminho.style.transform = 'translateY(-6%) scaleY(0.92)';
  hanko.style.transition = `opacity ${GUARDAR_ENROLAR * 0.5}ms ease`;
  hanko.style.opacity = '0';
  await dorme(GUARDAR_ENROLAR);

  // Recolher: o que sobrou desliza até a aba da estante (canto direito).
  pergaminho.style.transition = `transform ${GUARDAR_RECOLHER}ms ease-in, opacity ${GUARDAR_RECOLHER}ms ease`;
  pergaminho.style.transform = 'translate(46vw, 0) scale(0.08)';
  pergaminho.style.opacity = '0';
  await dorme(GUARDAR_RECOLHER);
}

function esconderCenaGuardar() {
  cenaGuardar.hidden = true;
  hanko.classList.remove('bater');
  hanko.style.opacity = '';
  pergaminho.style.transition = 'none';
  pergaminho.style.transform = 'none';
  pergaminho.style.clipPath = 'none';
  pergaminho.style.opacity = '';
}

/** Pixels do capturar() → dataURL JPEG (linhas do WebGL vêm de baixo para
 *  cima; o eixo y é invertido ao desenhar no canvas 2D). */
function capturaParaDataUrl({ pixels, w, h }) {
  const tela = document.createElement('canvas');
  tela.width = w;
  tela.height = h;
  const ctx = tela.getContext('2d');
  const imagem = ctx.createImageData(w, h);
  for (let linha = 0; linha < h; linha++) {
    const origem = (h - 1 - linha) * w * 4;
    imagem.data.set(pixels.subarray(origem, origem + w * 4), linha * w * 4);
  }
  ctx.putImageData(imagem, 0, 0);
  return tela.toDataURL('image/jpeg', 0.85);
}

function registrarObra(imagem, calidez, ehFundacao) {
  obras.push({
    id: 'o' + Date.now().toString(36),
    nome: gerarNome(new Date(), calidez, rng),
    criadaEm: Date.now(),
    imagem,
    ehFundacao,
  });
  salvarEstante();
}

/** Persiste a estante, com folga para a cota do localStorage: se faltar
 *  espaço, descarta a obra mais antiga que NÃO seja a fundação (ela é
 *  permanente) e tenta de novo. */
function salvarEstante() {
  try {
    localStorage.setItem(CHAVE_ESTANTE, JSON.stringify(obras));
  } catch {
    const i = obras.findIndex((o) => !o.ehFundacao);
    if (i >= 0) {
      obras.splice(i, 1);
      salvarEstante();
    }
    // Se só a fundação resta e ainda não cabe, desiste em silêncio: a
    // sessão segue funcionando, só não persiste.
  }
}

// ---------------------------------------------------------------------------
// Ritual de entrada (primeira visita)
// ---------------------------------------------------------------------------

const convite = document.getElementById('convite');
let conviteEscondido = false;

function esconderConvite() {
  if (conviteEscondido) return;
  conviteEscondido = true;
  convite.classList.add('escondida');
}

/**
 * A água assentou: a sala ganha alma. Extrai o tom da fundação (camada 2
 * da luz), e a obra segue o fluxo de guardar (vira o 1º pergaminho). Se a
 * pintura for tímida demais, não força nada — a sala fica neutra e a
 * próxima visita oferece o ritual de novo.
 */
async function concluirRitual() {
  const captura = fluido.capturar(64);
  const tom = extrairTomFundacao(captura.pixels, captura.w, captura.h, hexParaRgb(COR_PAPEL));
  if (tom.forca < 0.05) {
    emRitual = false;
    ondulacaoAlvo = 1;
    return;
  }

  emRitual = false;
  tomFundacao = tom;
  gravarArmazenado(CHAVE_FUNDACAO, tomFundacao);
  atualizarAtmosfera(); // a sala ganha alma (transição suave do overlay)

  // A obra segue para guardar como a fundação (primeira da estante).
  await guardar(true);

  // "esta sala é sua." — breve, discreto, some sozinho.
  const aviso = document.getElementById('aviso');
  aviso.hidden = false;
  requestAnimationFrame(() => aviso.classList.add('visivel'));
  setTimeout(() => {
    aviso.classList.remove('visivel');
    setTimeout(() => (aviso.hidden = true), 1400);
  }, 4000);
}

// ---------------------------------------------------------------------------
// Paleta (gotas) com long-press para cor personalizada
// ---------------------------------------------------------------------------

const editorCor = document.getElementById('editor-cor');
const entradaCor = document.getElementById('entrada-cor');
const botaoRestaurar = document.getElementById('restaurar-cor');
let indiceEmEdicao = null;

function montarPaleta() {
  const barra = document.getElementById('paleta');
  barra.textContent = '';

  PALETA.forEach((tinta, indice) => {
    const botao = document.createElement('button');
    botao.className = 'cor';
    botao.dataset.indice = indice;
    botao.style.setProperty('--cor', corDoSwatch(indice));
    botao.setAttribute('aria-label', `tinta ${tinta.nome}`);
    botao.title = tinta.nome;
    if (coresPersonalizadas[indice]) botao.classList.add('personalizada');
    if (selecao === indice) botao.classList.add('ativa');

    // Long-press (tempo, ~450ms) abre o editor; toque curto seleciona.
    let timerLong = null;
    let foiLong = false;
    botao.addEventListener('pointerdown', () => {
      foiLong = false;
      timerLong = setTimeout(() => {
        foiLong = true;
        abrirEditorCor(indice, botao);
      }, DURACAO_LONGPRESS);
    });
    const cancelar = () => clearTimeout(timerLong);
    botao.addEventListener('pointerleave', cancelar);
    botao.addEventListener('pointercancel', cancelar);
    botao.addEventListener('pointerup', cancelar);
    botao.addEventListener('click', () => {
      if (!foiLong) selecionar(indice);
    });

    barra.appendChild(botao);
  });

  // Água: gota especial — não personalizável (é o próprio papel).
  const agua = document.createElement('button');
  agua.className = 'cor agua';
  agua.style.setProperty('--cor', COR_PAPEL);
  agua.setAttribute('aria-label', 'água');
  agua.title = 'água';
  if (selecao === 'agua') agua.classList.add('ativa');
  agua.addEventListener('click', () => selecionar('agua'));
  barra.appendChild(agua);
}

function selecionar(nova) {
  selecao = nova;
  document.querySelectorAll('#paleta .cor').forEach((b) => {
    const dele = b.classList.contains('agua') ? 'agua' : Number(b.dataset.indice);
    b.classList.toggle('ativa', dele === selecao);
  });
}

function abrirEditorCor(indice, ancora) {
  indiceEmEdicao = indice;
  entradaCor.value = corDoSwatch(indice);
  botaoRestaurar.hidden = !coresPersonalizadas[indice];
  const r = ancora.getBoundingClientRect();
  editorCor.hidden = false;
  const largura = editorCor.offsetWidth;
  editorCor.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - largura / 2, innerWidth - largura - 8))}px`;
  editorCor.style.top = `${r.top - editorCor.offsetHeight - 10}px`;
}

function fecharEditorCor() {
  editorCor.hidden = true;
  indiceEmEdicao = null;
}

entradaCor.addEventListener('input', () => {
  if (indiceEmEdicao === null) return;
  coresPersonalizadas[indiceEmEdicao] = entradaCor.value;
  gravarArmazenado(CHAVE_PALETA, coresPersonalizadas);
  montarPaleta();
});

botaoRestaurar.addEventListener('click', () => {
  if (indiceEmEdicao === null) return;
  delete coresPersonalizadas[indiceEmEdicao];
  gravarArmazenado(
    CHAVE_PALETA,
    Object.keys(coresPersonalizadas).length ? coresPersonalizadas : null
  );
  montarPaleta();
  fecharEditorCor();
});

window.addEventListener('pointerdown', (e) => {
  if (!editorCor.hidden && !editorCor.contains(e.target)) fecharEditorCor();
});

// ---------------------------------------------------------------------------
// Estante (tokonoma) — exposição de UMA obra por vez
// ---------------------------------------------------------------------------

const estante = document.getElementById('estante');
const obraImg = document.getElementById('obra-img');
const obraNome = document.getElementById('obra-nome');
const obraMeta = document.getElementById('obra-meta');
const figura = document.getElementById('obra-foco');
const estanteVazia = document.getElementById('estante-vazia');
const botaoApagar = document.getElementById('apagar-obra');
const botaoExportar = document.getElementById('exportar-obra');
let confirmandoApagar = false;

function abrirEstante() {
  estanteAberta = true;
  recolherFerramentas();
  focoEstante = obras.length - 1; // a obra mais recente
  estante.hidden = false;
  renderEstante();
}

function fecharEstante() {
  estanteAberta = false;
  estante.hidden = true;
}

function renderEstante() {
  const vazia = obras.length === 0;
  estanteVazia.hidden = !vazia;
  figura.style.display = vazia ? 'none' : '';
  document.querySelectorAll('.navegar').forEach((b) => (b.style.display = vazia ? 'none' : ''));
  if (vazia) return;

  focoEstante = Math.max(0, Math.min(focoEstante, obras.length - 1));
  const obra = obras[focoEstante];
  // imagem é o campo atual; miniatura é o de obras salvas antes do export.
  obraImg.src = obra.imagem || obra.miniatura;
  obraNome.textContent = obra.nome;
  // Metadados: hora de criação; a fundação ganha a marca 元 ("origem").
  obraMeta.innerHTML = `${horaFormatada(obra.criadaEm)}${
    obra.ehFundacao ? ' <span class="origem" title="a fundação desta sala">元</span>' : ''
  }`;

  // A fundação é permanente: não pode ser apagada.
  botaoApagar.disabled = obra.ehFundacao;
  botaoApagar.textContent = 'apagar';
  confirmandoApagar = false;
  botaoExportar.disabled = false;
  botaoExportar.textContent = 'exportar';
}

function navegar(passo) {
  if (obras.length === 0) return;
  focoEstante = (focoEstante + passo + obras.length) % obras.length;
  // Transição curta de troca (respeitando reduced-motion via CSS).
  figura.querySelector('#moldura').style.opacity = '0.2';
  setTimeout(() => {
    renderEstante();
    figura.querySelector('#moldura').style.opacity = '1';
  }, reduzMovimento.matches ? 0 : 160);
}

document.getElementById('aba-estante').addEventListener('click', abrirEstante);
document.getElementById('fechar-estante').addEventListener('click', fecharEstante);
document.querySelector('.navegar.anterior').addEventListener('click', () => navegar(-1));
document.querySelector('.navegar.proxima').addEventListener('click', () => navegar(1));

// Teclado: setas navegam, Esc fecha.
window.addEventListener('keydown', (e) => {
  if (!estanteAberta) return;
  if (e.key === 'ArrowLeft') navegar(-1);
  else if (e.key === 'ArrowRight') navegar(1);
  else if (e.key === 'Escape') fecharEstante();
});

// Swipe horizontal (mobile) para trocar de obra.
let swipeX = null;
estante.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button') || e.target.closest('#acoes-obra')) return;
  swipeX = e.clientX;
});
estante.addEventListener('pointerup', (e) => {
  if (swipeX === null) return;
  const dx = e.clientX - swipeX;
  if (Math.abs(dx) > 60) navegar(dx < 0 ? 1 : -1);
  swipeX = null;
});

// Renomear: torna o nome editável; salva ao sair/Enter.
document.getElementById('renomear-obra').addEventListener('click', () => {
  if (obras.length === 0) return;
  obraNome.classList.add('editavel');
  obraNome.contentEditable = 'true';
  obraNome.focus();
  // Seleciona o texto inteiro para troca rápida.
  const sel = getSelection();
  sel.removeAllRanges();
  const r = document.createRange();
  r.selectNodeContents(obraNome);
  sel.addRange(r);
});

function salvarNome() {
  if (!obraNome.isContentEditable) return;
  obraNome.contentEditable = 'false';
  obraNome.classList.remove('editavel');
  const nome = obraNome.textContent.trim();
  if (nome) {
    obras[focoEstante].nome = nome;
    salvarEstante();
  } else {
    obraNome.textContent = obras[focoEstante].nome;
  }
}

obraNome.addEventListener('blur', salvarNome);
obraNome.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    obraNome.blur();
  }
});

// Apagar: dois toques (clique → "confirmar?" → confirma). A fundação não
// pode ser apagada (botão desabilitado em renderEstante).
botaoApagar.addEventListener('click', () => {
  if (botaoApagar.disabled) return;
  if (!confirmandoApagar) {
    confirmandoApagar = true;
    botaoApagar.textContent = 'confirmar?';
    return;
  }
  obras.splice(focoEstante, 1);
  salvarEstante();
  if (obras.length === 0) fecharEstante();
  else {
    focoEstante = Math.max(0, focoEstante - 1);
    renderEstante();
  }
});

botaoExportar.addEventListener('click', exportarObra);

/**
 * Baixa a obra em foco como PNG. A imagem é a que foi capturada ao guardar
 * (a simulação não guarda estado por obra, então é esta a resolução
 * disponível). Desenha o JPEG armazenado num canvas e exporta PNG —
 * o formato que se espera para salvar arte.
 */
function exportarObra() {
  const obra = obras[focoEstante];
  if (!obra) return;
  const fonte = obra.imagem || obra.miniatura;
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    cv.getContext('2d').drawImage(img, 0, 0);
    cv.toBlob((blob) => {
      if (blob) baixarArquivo(blob, nomeDeArquivo(obra));
    }, 'image/png');
  };
  img.src = fonte;

  botaoExportar.textContent = 'baixando…';
  setTimeout(() => (botaoExportar.textContent = 'exportar'), 1200);
}

/** Dispara o download de um Blob via um <a download> temporário. */
function baixarArquivo(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Nome de arquivo amigável: "suminagashi-mare-da-noite-20260613.png". */
function nomeDeArquivo(obra) {
  const slug = obra.nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos (marcas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const d = new Date(obra.criadaEm);
  const data = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `suminagashi-${slug || 'obra'}-${data}.png`;
}

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

montarPaleta();
document.getElementById('lavar').addEventListener('click', lavar);
document.getElementById('guardar').addEventListener('click', () => guardar(false));
window.addEventListener('resize', () => fluido.redimensionar());

// Primeira visita (sem fundação) → ritual. Retorno → ocioso, sala com alma.
if (!tomFundacao) {
  emRitual = true;
  convite.textContent = TEXTO_CONVITE;
} else {
  conviteEscondido = true;
  convite.classList.add('escondida');
}

atualizarAtmosfera();
setInterval(atualizarAtmosfera, 60000);
requestAnimationFrame(quadro);
