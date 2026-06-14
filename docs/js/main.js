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
import { gerarNome, gerarHaiku, sementeDaObra, horaFormatada } from './estante.js';
import { MODOS, hexParaRgb } from './modos.js';

// ---------------------------------------------------------------------------
// Constantes (chutes iniciais agrupados; calibrar no tato)
// ---------------------------------------------------------------------------

const CHAVE_PALETA = 'paleta.v1';
const CHAVE_FUNDACAO = 'fundacao.v1'; // viés de tom (camada 2 da luz)
const CHAVE_ESTANTE = 'estante.v1'; // array de obras guardadas
const CHAVE_MODO = 'modoAtual.v1'; // 'agua' | 'cosmos'

// Estrelas (modo cosmos)
const TAP_ESTRELA_MS = 260; // tap mais curto que isto = estrela; segurar = nebulosa
const ESTRELA_TAM = [0.004, 0.013]; // tamanho (fração da altura) — via PRNG
const ESTRELA_BRILHO = [0.7, 1.3]; // brilho — via PRNG

// Cosmos: a deriva é mais lenta que a da água (o lento girar do espaço).
const RITMO_COSMOS = 0.5;
// Brilho de emissão do cosmos pelo ciclo de luz: de madrugada brilha de
// verdade contra o escuro; ao meio-dia fica mais lavado/sutil.
const BRILHO_NOITE = 1.15;
const BRILHO_DIA = 0.55;

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

// A imagem de cada obra é GUARDADA na resolução NATIVA da grade de tinta
// (ver larguraCaptura) — todo o detalhe que a simulação produziu, sem
// desperdício. Essas imagens são grandes (1–3MB), então vivem no
// IndexedDB (cota de centenas de MB), não no localStorage (~5MB); só os
// metadados leves ficam no localStorage.

// Lado maior (px) do PNG EXPORTADO. Um arquivo 4K já vem no tamanho do
// monitor, então o sistema operacional não precisa esticá-lo para virar
// wallpaper. Se a captura nativa for menor, sobe-se até aqui (ampliação
// leve, limpa em marmoreio); se for maior, exporta no tamanho nativo.
const LARGURA_EXPORT = 3840;

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

// --- IndexedDB: as imagens das obras (grandes demais p/ o localStorage) ---
// Cota de centenas de MB. Se indexedDB falhar (modo restrito), o chamador
// cai para guardar a imagem embutida na própria obra (ver registrarObra).

const IDB_STORE = 'imagens';
let _idb = null;

function abrirBanco() {
  if (_idb) return _idb;
  _idb = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open('suminagashi', 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
  return _idb;
}

async function idbGravar(chave, valor) {
  const db = await abrirBanco();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(valor, chave);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function idbLer(chave) {
  const db = await abrirBanco();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const r = tx.objectStore(IDB_STORE).get(chave);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}

async function idbApagar(chave) {
  try {
    const db = await abrirBanco();
    await new Promise((res) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(chave);
      tx.oncomplete = () => res();
      tx.onerror = () => res(); // apagar é best-effort
    });
  } catch {
    /* sem banco: nada a apagar */
  }
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

// (hexParaRgb vem de modos.js — é compartilhado com a definição dos modos.)

const rng = mulberry32(Date.now());

// Modo atual (água | cosmos). O objeto de configuração concentra TUDO que
// difere entre os modos (ver modos.js); o resto do código fala com `modo`.
let idModo = lerArmazenado(CHAVE_MODO) || 'agua';
if (!MODOS[idModo]) idModo = 'agua';
let modo = MODOS[idModo];

/**
 * Resolução da grade de tinta conforme o aparelho. É o que define o
 * DETALHE REAL da água (e, portanto, a nitidez das exportações): ampliar
 * depois não cria detalhe, só a simulação em resolução maior cria. Por
 * isso desktops potentes ganham uma grade bem mais fina; celulares ficam
 * leves para não perder os 60fps. A grade de velocidade não muda.
 */
function escolherResTinta() {
  const fino = matchMedia('(pointer: fine)').matches; // mouse, não dedo
  const nucleos = navigator.hardwareConcurrency || 4;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const ladoMaiorFisico = Math.max(screen.width, screen.height) * dpr;
  if (fino && nucleos >= 8 && ladoMaiorFisico >= 2200) return 2048; // tela grande + CPU forte
  if (fino && ladoMaiorFisico >= 1500) return 1536; // desktop comum
  return 1024; // mobile / leve (o valor original)
}

const canvas = document.getElementById('agua');
let fluido;
try {
  fluido = criarFluido(canvas, hexParaRgb(modo.fundo), { resTinta: escolherResTinta() });
  fluido.definirModo(modo.render);
} catch (e) {
  document.getElementById('convite').textContent =
    'este navegador não suporta a simulação de água (WebGL2)';
  throw e;
}

const reduzMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');
const corpo = document.body;
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

// Cores personalizadas (long-press), por modo+índice — as paletas diferem.
const coresPersonalizadas = lerArmazenado(CHAVE_PALETA) || {};
const chaveCor = (i) => `${idModo}:${i}`;
const corDoSwatch = (i) => coresPersonalizadas[chaveCor(i)] || modo.paleta[i].cor;

// Seleção atual: índice da paleta do modo, ou 'especial' (água / vazio).
let selecao = 0;

// Estrelas do cosmos (não são fluido): lista viva, desenhada por cima.
// Cada uma: { xn, yn (0..1), tam, cor:[r,g,b], brilho, fase }.
let estrelas = [];

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
  // No cosmos o overlay é mais leve (o vazio já é escuro).
  const escalaOverlay = idModo === 'cosmos' ? 0.4 : 1;
  const { centro, borda } = corDaAtmosfera(atm, escalaOverlay);
  overlayAtmosfera.style.setProperty('--atm-centro', centro);
  overlayAtmosfera.style.setProperty('--atm-borda', borda);

  // Cosmos: o ciclo do relógio se inverte em significado — de madrugada o
  // gás brilha de verdade contra o escuro; ao meio-dia fica mais lavado.
  if (idModo === 'cosmos') {
    const t = Math.max(0, Math.min(1, (1.05 - atm.luminosidade) / (1.05 - 0.42)));
    fluido.definirBrilho(BRILHO_DIA + (BRILHO_NOITE - BRILHO_DIA) * t);
  }
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
  aoPingar(x, y, duracao) {
    if (estanteAberta || guardando) return;
    // No cosmos, um tap RÁPIDO acende uma estrela (ponto de luz fixo);
    // segurar um instante deposita uma nebulosa (gás). Na água, tap é
    // sempre gota. Reusa o mesmo limiar tap-vs-drag; só o tap se desdobra.
    if (idModo === 'cosmos' && selecao !== 'especial' && duracao < TAP_ESTRELA_MS) {
      acenderEstrela(x, y, corDoSwatch(selecao));
    } else {
      const raio = entre(rng, RAIO_MINIMO, RAIO_MAXIMO);
      if (selecao === 'especial') fluido.pingarAgua(x, y, raio); // água dilui / vazio apaga
      else fluido.pingar(x, y, raio, modo.densidade(hexParaRgb(corDoSwatch(selecao))));
    }
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

  // Estrelas cintilam (cosmos), exceto sob prefers-reduced-motion.
  fluido.exibir(agora / 1000, !reduzMovimento.matches);
  requestAnimationFrame(quadro);
}

/** Acende uma estrela fixa (cosmos): ponto de luz que NÃO advecta — o gás
 *  flui por trás. Tamanho/brilho variam via PRNG seedável. */
function acenderEstrela(x, y, corHex) {
  estrelas.push({
    xn: x / canvas.clientWidth,
    yn: y / canvas.clientHeight,
    tam: entre(rng, ESTRELA_TAM[0], ESTRELA_TAM[1]),
    cor: hexParaRgb(corHex),
    brilho: entre(rng, ESTRELA_BRILHO[0], ESTRELA_BRILHO[1]),
    fase: rng() * Math.PI * 2,
  });
  fluido.definirEstrelas(estrelas);
}

function limparEstrelas() {
  if (estrelas.length === 0) return;
  estrelas = [];
  fluido.definirEstrelas(estrelas);
}

function lavar() {
  if (inicioLavagem !== null) return;
  if (reduzMovimento.matches) fluido.desbotar(1);
  else inicioLavagem = performance.now();
  limparEstrelas();
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

  // Captura a obra já assentada na resolução NATIVA da grade de tinta —
  // todo o detalhe que a simulação produziu, no render do modo atual
  // (água ou cosmos), com as estrelas embutidas e SEM cintilar (still).
  const captura = fluido.capturar(larguraCaptura(), performance.now() / 1000, false);
  const dataUrl = capturaParaDataUrl(captura);
  const tom = extrairTomFundacao(captura.pixels, captura.w, captura.h, hexParaRgb(modo.fundo));

  // 2. Selar: o hanko desce e carimba.
  baterHanko();
  await dorme(reduz ? 140 : GUARDAR_SELAR);

  // 3 + 4. Enrolar em pergaminho e recolher até a aba (só com animação).
  if (!reduz) await enrolarPergaminho(dataUrl);

  // Registra a obra na estante (com o modo e o batismo).
  await registrarObra(dataUrl, tom.calidez, ehFundacao);

  // 5. Limpa, cena escondida, volta ao ocioso.
  fluido.desbotar(1);
  limparEstrelas();
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
  return tela.toDataURL('image/jpeg', 0.92);
}

/** Lado maior da captura: a resolução nativa da grade de tinta, sem passar
 *  do alvo de export (não adianta guardar além do que vira arquivo). */
function larguraCaptura() {
  return Math.min(fluido.dimensoesTinta()[0], LARGURA_EXPORT);
}

/**
 * Registra a obra: metadados leves no localStorage, imagem (grande) no
 * IndexedDB. Se o banco falhar, embute a imagem na própria obra como
 * fallback (vale ao menos na sessão).
 */
async function registrarObra(dataUrl, calidez, ehFundacao) {
  const id = 'o' + Date.now().toString(36);
  const criadaEm = Date.now();
  // Batismo LOCAL e DETERMINÍSTICO: o nome (e o haiku) vêm de um hash da
  // própria obra (modo + tom + hora + nº de estrelas), pelo léxico do
  // modo. Mesma obra → mesmo nome. Nada de rede/IA.
  const semente = sementeDaObra({ modo: idModo, calidez, timestamp: criadaEm, estrelas: estrelas.length });
  const data = new Date(criadaEm);
  const obra = {
    id,
    modo: idModo, // 'agua' | 'cosmos'
    nome: gerarNome(modo, data, calidez, semente),
    haiku: gerarHaiku(modo, data, calidez, semente),
    criadaEm,
    ehFundacao,
  };
  try {
    await idbGravar(id, dataUrl);
  } catch {
    obra.imagem = dataUrl; // fallback: embutida (sem IndexedDB)
  }
  obras.push(obra);
  salvarEstante();
}

/** Recupera a imagem de uma obra: embutida (obras antigas/fallback) ou
 *  do IndexedDB. */
async function obterImagem(obra) {
  if (obra.imagem) return obra.imagem;
  if (obra.miniatura) return obra.miniatura; // compat: nome do campo antigo
  try {
    return await idbLer(obra.id);
  } catch {
    return null;
  }
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
      const [removida] = obras.splice(i, 1);
      idbApagar(removida.id); // não deixa a imagem órfã no banco
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
  const tom = extrairTomFundacao(captura.pixels, captura.w, captura.h, hexParaRgb(modo.fundo));
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

  modo.paleta.forEach((tinta, indice) => {
    const botao = document.createElement('button');
    botao.className = 'cor';
    botao.dataset.indice = indice;
    botao.style.setProperty('--cor', corDoSwatch(indice));
    botao.setAttribute('aria-label', `${tinta.nome}`);
    botao.title = tinta.nome;
    if (coresPersonalizadas[chaveCor(indice)]) botao.classList.add('personalizada');
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

  // Pincel especial do modo: água (dilui pigmento) ou vazio (apaga luz).
  // Não personalizável — é derivado do fundo do modo.
  const especial = document.createElement('button');
  especial.className = 'cor especial';
  especial.style.setProperty('--cor', modo.fundo);
  especial.setAttribute('aria-label', modo.especial.nome);
  especial.title = modo.especial.nome;
  if (selecao === 'especial') especial.classList.add('ativa');
  especial.addEventListener('click', () => selecionar('especial'));
  barra.appendChild(especial);
}

function selecionar(nova) {
  selecao = nova;
  document.querySelectorAll('#paleta .cor').forEach((b) => {
    const dele = b.classList.contains('especial') ? 'especial' : Number(b.dataset.indice);
    b.classList.toggle('ativa', dele === selecao);
  });
}

function abrirEditorCor(indice, ancora) {
  indiceEmEdicao = indice;
  entradaCor.value = corDoSwatch(indice);
  botaoRestaurar.hidden = !coresPersonalizadas[chaveCor(indice)];
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
  coresPersonalizadas[chaveCor(indiceEmEdicao)] = entradaCor.value;
  gravarArmazenado(CHAVE_PALETA, coresPersonalizadas);
  montarPaleta();
});

botaoRestaurar.addEventListener('click', () => {
  if (indiceEmEdicao === null) return;
  delete coresPersonalizadas[chaveCor(indiceEmEdicao)];
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
const obraHaiku = document.getElementById('obra-haiku');
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

async function renderEstante() {
  const vazia = obras.length === 0;
  estanteVazia.hidden = !vazia;
  figura.style.display = vazia ? 'none' : '';
  document.querySelectorAll('.navegar').forEach((b) => (b.style.display = vazia ? 'none' : ''));
  if (vazia) return;

  focoEstante = Math.max(0, Math.min(focoEstante, obras.length - 1));
  const obra = obras[focoEstante];
  obterImagem(obra).then((src) => {
    // Só aplica se ainda estamos nesta obra (navegação rápida).
    if (obras[focoEstante] === obra && src) obraImg.src = src;
  });
  obraNome.textContent = obra.nome;
  // Haiku (se houver — obras anteriores à v4 não têm).
  obraHaiku.innerHTML = obra.haiku ? obra.haiku.join('<br>') : '';
  obraHaiku.hidden = !obra.haiku;
  // Metadados: modo + hora; a fundação ganha a marca 元 ("origem").
  const selo = obra.modo === 'cosmos' ? '✦' : '水';
  obraMeta.innerHTML = `${selo} · ${horaFormatada(obra.criadaEm)}${
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
  const [removida] = obras.splice(focoEstante, 1);
  idbApagar(removida.id); // libera a imagem do banco (best-effort)
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
async function exportarObra() {
  const obra = obras[focoEstante];
  if (!obra) return;
  const fonte = await obterImagem(obra);
  if (!fonte) return;

  botaoExportar.textContent = 'gerando 4K…';
  try {
    const img = await carregarImagem(fonte);
    // Exporta na PROPORÇÃO DA TELA, não na da janela do navegador. A obra é
    // capturada no formato da janela (mais larga e baixa que o monitor por
    // causa da barra de abas), então, como wallpaper, o sistema operacional
    // teria de esticar/recortar — era isso que mexia na escala e na
    // qualidade. Aqui geramos a imagem já no formato exato do monitor
    // (cobrindo + recorte central), em 4K: o wallpaper encaixa perfeito,
    // sem o SO deformar nada.
    const { w, h } = alvoWallpaper();
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // "cover": escala para preencher o alvo e recorta o excedente, centrado.
    const escala = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * escala;
    const dh = img.naturalHeight * escala;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    if (blob) baixarArquivo(URL.createObjectURL(blob), nomeDeArquivo(obra, 'png'), true);
    else baixarArquivo(fonte, nomeDeArquivo(obra, 'jpg'), false); // fallback
  } catch {
    // Qualquer falha (toBlob, canvas) → baixa o JPEG guardado direto.
    baixarArquivo(fonte, nomeDeArquivo(obra, 'jpg'), false);
  }
  setTimeout(() => (botaoExportar.textContent = 'exportar'), 1200);
}

/**
 * Dimensões do PNG de wallpaper: a PROPORÇÃO da tela do usuário, com lado
 * maior em 4K (LARGURA_EXPORT). Usar a proporção (e não pixels absolutos)
 * é robusto ao zoom do navegador, que distorce devicePixelRatio mas não a
 * razão largura/altura do monitor.
 */
function alvoWallpaper() {
  const sw = screen.width || 16;
  const sh = screen.height || 9;
  const aspecto = sw / sh;
  return aspecto >= 1
    ? { w: LARGURA_EXPORT, h: Math.round(LARGURA_EXPORT / aspecto) }
    : { w: Math.round(LARGURA_EXPORT * aspecto), h: LARGURA_EXPORT };
}

function carregarImagem(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Dispara o download via um <a download> temporário. Para object URLs a
 * revogação é ADIADA: revogar logo após o clique cancela o download em
 * alguns navegadores, porque a leitura do blob ainda nem começou.
 */
function baixarArquivo(href, nome, ehObjectUrl) {
  const a = document.createElement('a');
  a.href = href;
  a.download = nome;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (ehObjectUrl) setTimeout(() => URL.revokeObjectURL(href), 4000);
}

/** Nome de arquivo amigável: "suminagashi-mare-da-noite-20260613.png". */
function nomeDeArquivo(obra, extensao) {
  const slug = obra.nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos (marcas combinantes)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const d = new Date(obra.criadaEm);
  const data = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `suminagashi-${slug || 'obra'}-${data}.${extensao}`;
}

// ---------------------------------------------------------------------------
// Alternância de modo (água ↔ cosmos)
// ---------------------------------------------------------------------------

const botaoModo = document.getElementById('alternar-modo');

/** Aplica o modo atual ao motor e à UI. NÃO limpa a obra: é o MESMO fluido,
 *  só lido no espelho (água absorve, cosmos emite) — trocar não perde nada.
 *  A respiração fica mais lenta no cosmos (o lento girar do espaço). */
function aplicarModo() {
  fluido.definirModo(modo.render);
  fluido.definirFundo(hexParaRgb(modo.fundo));
  fluido.definirRitmo(idModo === 'cosmos' ? RITMO_COSMOS : 1);
  corpo.classList.toggle('modo-cosmos', idModo === 'cosmos');
  // A seleção pode não existir na nova paleta — volta para a 1ª tinta.
  if (selecao !== 'especial' && selecao >= modo.paleta.length) selecao = 0;
  botaoModo.textContent = idModo === 'cosmos' ? '✦' : '◐';
  botaoModo.title = idModo === 'cosmos' ? 'cosmos (trocar para água)' : 'água (trocar para cosmos)';
  montarPaleta();
  atualizarAtmosfera();
}

function trocarModo() {
  idModo = idModo === 'agua' ? 'cosmos' : 'agua';
  modo = MODOS[idModo];
  gravarArmazenado(CHAVE_MODO, idModo);
  aplicarModo();
}

botaoModo.addEventListener('click', trocarModo);

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

aplicarModo(); // monta a paleta do modo + fundo/ritmo/atmosfera
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

// Migra imagens de obras antigas (que ficavam embutidas no localStorage)
// para o IndexedDB, aliviando a cota. Best-effort, em segundo plano.
migrarImagens();

async function migrarImagens() {
  let mudou = false;
  for (const obra of obras) {
    const inline = obra.imagem || obra.miniatura;
    if (!inline) continue;
    try {
      await idbGravar(obra.id, inline);
      delete obra.imagem;
      delete obra.miniatura;
      mudou = true;
    } catch {
      /* sem IndexedDB: mantém embutida */
    }
  }
  if (mudou) salvarEstante();
}
