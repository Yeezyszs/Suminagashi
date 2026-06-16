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
import { gerarNome, gerarHaiku, gerarPoema, sementeDaObra, horaFormatada, hash } from './estante.js';
import { MODOS, hexParaRgb } from './modos.js';
import { HAIKUS, selecionarHaiku, temperaturaDaCalidez } from './haiku.js';

// ---------------------------------------------------------------------------
// Constantes (chutes iniciais agrupados; calibrar no tato)
// ---------------------------------------------------------------------------

const CHAVE_PALETA = 'paleta.v1';
const CHAVE_FUNDACAO = 'fundacao.v1'; // viés de tom (camada 2 da luz)
const CHAVE_ESTANTE = 'estante.v1'; // array de obras guardadas
const CHAVE_MODO = 'modoAtual.v1'; // 'agua' | 'cosmos'

// --- COSMOS: pintura de luz (motor irmão da água; ver fluido.js) ----------
// O cosmos NÃO roda o solver de fluido: é uma tela parada onde pincéis
// depositam/espalham/apagam LUZ no buffer. Estrelas FLORESCEM do acúmulo.

// Poeira (pincel de cor): cada toque deposita pouca luz; passar de novo
// acumula em camadas (impasto). Raio macio e largo.
const POEIRA_INTENSIDADE = 0.16; // luz por depósito (baixa, p/ acumular)
const POEIRA_RAIO = 55; // px, pincel macio

// Estrela por acúmulo: numa grade grossa, somamos a poeira depositada; ao
// cruzar o limiar, uma estrela floresce ali e a célula recua (precisa
// reacumular para acender outra). O limiar é o número mais sensível —
// alto demais nunca acende; baixo demais vira campo de ruído.
const CELULA_BLOOM = 26; // px por célula da grade de acúmulo
const ESTRELA_LIMIAR = 1.5; // acúmulo necessário para florescer
const ESTRELA_RECUO = 0.7; // fração subtraída da célula após florescer
const ESTRELA_TAM = [0.005, 0.016]; // tamanho (fração da altura) — via PRNG
const ESTRELA_BRILHO = [0.8, 1.5]; // brilho — via PRNG

// Sopro (espalhar luz): deslocamento local na direção do gesto.
const SOPRO_RAIO = 80;
const SOPRO_FORCA = 0.06; // fração de uv deslocada no centro do pincel

// Vazio (apagar luz): raio e força do apagador.
const VAZIO_RAIO = 50;

// Assentar: a luz recém-pintada difunde de leve por ~1.4s e PARA.
const ASSENTAR_DURACAO = 1400; // ms
const ASSENTAR_FORCA = 0.1; // intensidade máxima da difusão (decai a 0)

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

// Estrelas do cosmos (florescem do acúmulo de poeira): lista viva,
// desenhada por cima. Cada uma: { xn, yn, tam, cor:[r,g,b], brilho, fase }.
let estrelas = [];
let estrelasSujas = false; // pede reenvio do buffer à GPU no próximo quadro

// Grade de acúmulo da poeira (para o florescer das estrelas).
let bloomGrade = null; // Float32Array
let bloomCols = 0;
let bloomRows = 0;

// Assentar da luz: timestamp até quando a difusão pós-gesto roda.
let assentarAte = 0;

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
  aoPingar(x, y) {
    if (estanteAberta || guardando) return;
    if (idModo === 'cosmos') pintarLuz(x, y, 0, 0, 0); // tap = pousar luz parada
    else if (selecao === 'agua') fluido.pingarAgua(x, y, entre(rng, RAIO_MINIMO, RAIO_MAXIMO));
    else fluido.pingar(x, y, entre(rng, RAIO_MINIMO, RAIO_MAXIMO), modo.densidade(hexParaRgb(corDoSwatch(selecao))));
    gestosNoRitual++;
    marcarInteracao();
  },
  aoArrastar(x, y, mx, my, velPx) {
    if (estanteAberta || guardando) return;
    if (idModo === 'cosmos') pintarLuz(x, y, mx, my, velPx);
    else fluido.mexer(x, y, mx, my, velPx, RAIO_ESTILETE); // estilete da água
    registrarEnergia(velPx); // alimenta a "energia do gesto" (p/ o haiku)
    marcarInteracao();
  },
  aoSoltar() {
    gestosNoRitual++;
  },
});

// Energia do gesto: telemetria leve da cadência da pintura, usada para o
// "retrato" que escolhe o haiku. Acumula a velocidade dos arrastos (px/s); ao
// guardar, vira sereno|vivo|agitado e zera. (Limiares calibráveis.)
let energiaSoma = 0;
let energiaN = 0;
let energiaPico = 0;
const ENERGIA_VIVO = 650; // px/s: acima disso (média) o gesto é "vivo"
const ENERGIA_AGITADO = 1700; // px/s: pico acima disso é "agitado"

function registrarEnergia(velPx) {
  if (velPx > 0) {
    energiaSoma += velPx;
    energiaN++;
    if (velPx > energiaPico) energiaPico = velPx;
  }
}

/** Classifica a energia acumulada do gesto em sereno|vivo|agitado. */
function energiaDaSessao() {
  const media = energiaN ? energiaSoma / energiaN : 0;
  if (energiaPico > ENERGIA_AGITADO || media > ENERGIA_AGITADO * 0.6) return 'agitado';
  if (media > ENERGIA_VIVO || gestosNoRitual > 8) return 'vivo';
  return 'sereno';
}

function zerarEnergia() {
  energiaSoma = energiaN = energiaPico = 0;
}

const LIMIAR_LUA = 12; // nº de estrelas (cosmos) a partir do qual o haiku pode pender p/ "lua"

/**
 * Pincel de luz do cosmos. O que faz depende da seleção:
 *  - cor (poeira): deposita luz colorida que ACUMULA; onde acumula além do
 *    limiar, uma estrela floresce (não se pinga estrela direto);
 *  - 'sopro': espalha a luz já pintada na direção do gesto;
 *  - 'vazio': apaga luz.
 * Reinicia o relógio do "assentar" (a luz recém-posta acomoda por ~1.4s).
 */
function pintarLuz(x, y, mx, my, velPx) {
  if (selecao === 'sopro') {
    if (velPx > 0) fluido.soprar(x, y, mx, my, SOPRO_RAIO, SOPRO_FORCA);
  } else if (selecao === 'vazio') {
    fluido.pingarAgua(x, y, VAZIO_RAIO);
  } else {
    const cor = hexParaRgb(corDoSwatch(selecao));
    const densidade = cor.map((c) => c * POEIRA_INTENSIDADE);
    fluido.poeira(x, y, POEIRA_RAIO, densidade);
    acumularPoeira(x, y, cor); // alimenta o florescer das estrelas
  }
  assentarAte = performance.now() + ASSENTAR_DURACAO;
}

// ---------------------------------------------------------------------------
// Loop de animação
// ---------------------------------------------------------------------------

function quadro(agora) {
  // Com o templo aberto, a água "dorme": não simula nem renderiza (só a
  // galeria 3D roda). Mantém o loop vivo para retomar ao voltar ao ateliê.
  if (galeriaAberta) {
    quadroAnterior = agora;
    requestAnimationFrame(quadro);
    return;
  }

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

    if (idModo === 'agua') {
      // ÁGUA: roda a simulação de fluido (a água está sempre viva).
      ondulacaoAtual += (ondulacaoAlvo - ondulacaoAtual) * Math.min(1, dt * 3.5);
      fluido.passo(dt, reduzMovimento.matches ? 0 : ondulacaoAtual);
    } else if (!reduzMovimento.matches && agora < assentarAte) {
      // COSMOS: tela PARADA (sem solver). Só a luz recém-pintada "acomoda"
      // por ~1.4s após o gesto — uma difusão que decai e PARA.
      const restante = (assentarAte - agora) / ASSENTAR_DURACAO; // 1 → 0
      fluido.assentarLuz(ASSENTAR_FORCA * restante);
    }

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

  // Sobe as estrelas acumuladas no quadro (semear um rastro adiciona
  // muitas; reenviar o buffer uma vez só evita custo quadrático).
  if (estrelasSujas) {
    fluido.definirEstrelas(estrelas);
    estrelasSujas = false;
  }

  // Estrelas cintilam (cosmos), exceto sob prefers-reduced-motion.
  fluido.exibir(agora / 1000, !reduzMovimento.matches);
  requestAnimationFrame(quadro);
}

/** Garante a grade de acúmulo do tamanho atual da tela (reconstrói se mudou). */
function garantirGradeBloom() {
  const cols = Math.max(1, Math.ceil(canvas.clientWidth / CELULA_BLOOM));
  const rows = Math.max(1, Math.ceil(canvas.clientHeight / CELULA_BLOOM));
  if (!bloomGrade || cols !== bloomCols || rows !== bloomRows) {
    bloomCols = cols;
    bloomRows = rows;
    bloomGrade = new Float32Array(cols * rows);
  }
}

/** Soma poeira na célula sob (x,y). Ao cruzar o limiar, uma estrela
 *  FLORESCE ali (consequência de acumular luz, não um clique) e a célula
 *  recua — concentrar mais luz acende outra. */
function acumularPoeira(x, y, cor) {
  garantirGradeBloom();
  const c = Math.min(bloomCols - 1, Math.max(0, Math.floor(x / CELULA_BLOOM)));
  const r = Math.min(bloomRows - 1, Math.max(0, Math.floor(y / CELULA_BLOOM)));
  const i = r * bloomCols + c;
  bloomGrade[i] += POEIRA_INTENSIDADE;
  if (bloomGrade[i] >= ESTRELA_LIMIAR) {
    bloomGrade[i] -= ESTRELA_LIMIAR * ESTRELA_RECUO;
    const jit = CELULA_BLOOM * 0.3;
    adicionarEstrela(
      (c + 0.5) * CELULA_BLOOM + entre(rng, -jit, jit),
      (r + 0.5) * CELULA_BLOOM + entre(rng, -jit, jit),
      cor
    );
  }
}

/** Faz nascer uma estrela em (x,y), herdando (e clareando) a cor da poeira
 *  local — um núcleo mais branco que o gás à volta. O upload à GPU é
 *  adiado para uma vez por quadro (ver o loop). */
function adicionarEstrela(x, y, corBase) {
  const cor = corBase.map((ch) => ch + (1 - ch) * 0.55); // clareia rumo ao branco
  estrelas.push({
    xn: x / canvas.clientWidth,
    yn: y / canvas.clientHeight,
    tam: entre(rng, ESTRELA_TAM[0], ESTRELA_TAM[1]),
    cor,
    brilho: entre(rng, ESTRELA_BRILHO[0], ESTRELA_BRILHO[1]),
    fase: rng() * Math.PI * 2,
  });
  estrelasSujas = true;
}

function limparEstrelas() {
  if (bloomGrade) bloomGrade.fill(0);
  if (estrelas.length === 0) return;
  estrelas = [];
  estrelasSujas = true;
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

  // 1.5 O site LÊ a obra (retrato) + a data e ESCOLHE um haiku clássico de
  // melhor clima — silenciosamente; ele é revelado ao aproximar da obra no
  // templo. A identidade da obra (criadaEm/semente) é fixada aqui para o haiku
  // e o batismo concordarem.
  const criadaEm = Date.now();
  const semente = sementeDaObra({ modo: idModo, calidez: tom.calidez, timestamp: criadaEm, estrelas: estrelas.length });
  const retrato = {
    temperatura: temperaturaDaCalidez(tom.calidez),
    energia: energiaDaSessao(),
    imagem: idModo === 'cosmos' && estrelas.length >= LIMIAR_LUA ? ['lua'] : [],
  };
  const haiku = selecionarHaiku(retrato, new Date(criadaEm), semente);
  zerarEnergia();

  // 2. Selar: o hanko desce e carimba.
  baterHanko();
  await dorme(reduz ? 140 : GUARDAR_SELAR);

  // 3 + 4. Enrolar em pergaminho e recolher até a aba (só com animação).
  if (!reduz) await enrolarPergaminho(dataUrl);

  // Registra a obra na estante (modo, batismo, haiku clássico escolhido).
  await registrarObra(dataUrl, tom.calidez, ehFundacao, { criadaEm, semente, haiku });

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
async function registrarObra(dataUrl, calidez, ehFundacao, extras = {}) {
  const criadaEm = extras.criadaEm || Date.now();
  const id = 'o' + criadaEm.toString(36);
  // Batismo LOCAL e DETERMINÍSTICO: o nome (e o haiku-combinatório) vêm de um
  // hash da própria obra (modo + tom + hora + nº de estrelas), pelo léxico do
  // modo. Mesma obra → mesmo nome. Nada de rede/IA. (A semente é a mesma usada
  // para escolher o haiku clássico, fixada no guardar.)
  const semente =
    extras.semente != null
      ? extras.semente
      : sementeDaObra({ modo: idModo, calidez, timestamp: criadaEm, estrelas: estrelas.length });
  const data = new Date(criadaEm);
  const obra = {
    id,
    modo: idModo, // 'agua' | 'cosmos'
    nome: gerarNome(modo, data, calidez, semente),
    haiku: gerarHaiku(modo, data, calidez, semente),
    criadaEm,
    ehFundacao,
  };
  // Haiku CLÁSSICO escolhido (revelado no foco da galeria) — campos próprios,
  // sem colidir com o `haiku` combinatório do batismo. jpLinhas = 3 versos
  // (para renderizar em colunas limpas).
  const hk = extras.haiku;
  if (hk) {
    obra.haikuId = hk.id;
    obra.haikuJp = hk.jp;
    obra.haikuJpLinhas = hk.jpLinhas;
    obra.haikuRomaji = hk.romaji;
    obra.haikuPt = hk.pt;
    obra.haikuAutor = hk.autor;
  }
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

  // Pincéis especiais do modo (água/vazio diluem; estrelas espalha luz).
  // São derivados do modo, não personalizáveis. Cada um mostra um símbolo.
  modo.pinceis.forEach((p) => {
    const botao = document.createElement('button');
    botao.className = 'cor pincel';
    botao.dataset.pincel = p.id;
    botao.style.setProperty('--cor', p.id === 'estrelas' ? '#cdd8ff' : modo.fundo);
    botao.textContent = p.simbolo || '';
    botao.setAttribute('aria-label', p.nome);
    botao.title = p.nome;
    if (selecao === p.id) botao.classList.add('ativa');
    botao.addEventListener('click', () => selecionar(p.id));
    barra.appendChild(botao);
  });
}

function selecionar(nova) {
  selecao = nova;
  document.querySelectorAll('#paleta .cor').forEach((b) => {
    const dele = b.dataset.pincel || Number(b.dataset.indice);
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

// A aba da estante agora abre O TEMPLO (galeria 3D), não mais a estante 2D.
document.getElementById('aba-estante').addEventListener('click', abrirGaleria);
document.getElementById('fechar-estante').addEventListener('click', fecharEstante);
document.querySelector('.navegar.anterior').addEventListener('click', () => navegar(-1));
document.querySelector('.navegar.proxima').addEventListener('click', () => navegar(1));

// ---------------------------------------------------------------------------
// O Templo (galeria 3D) — abre a partir da aba; integra o ateliê e a coleção
// ---------------------------------------------------------------------------

const canvasGaleria = document.getElementById('galeria-canvas');
const galeriaUI = document.getElementById('galeria-ui');
const rotuloObra = document.getElementById('rotulo-obra');
const rotuloNome = document.getElementById('rotulo-nome');
const rotuloHaiku = document.getElementById('rotulo-haiku');
const galeriaVazia = document.getElementById('galeria-vazia');
const focoObraEl = document.getElementById('foco-obra');
const focoPoemaJa = document.getElementById('foco-poema-ja');
const focoPoemaPt = document.getElementById('foco-poema-pt');
const focoAutor = document.getElementById('foco-autor');
const focoAcoes = document.getElementById('foco-acoes');
const botaoBaixarFoco = document.getElementById('foco-baixar');
const botaoApagarFoco = document.getElementById('foco-apagar');

let galeria = null; // instância Three.js (criada sob demanda)
let navGaleria = null;
let galeriaAberta = false;
let loopGaleria = null;
let anteriorGaleria = null;
let focoIdAtual = null; // id da obra focada (evita recompor o poema todo quadro)
let confirmandoApagarFoco = false; // "apagar" pede confirmação (dois toques)
// Qualidade adaptativa: monitora o FPS REAL por janela e baixa a qualidade
// (DPR, sombra) se o quadro pesar. Só desce na sessão; reabrir o templo
// restaura o nível cheio.
let nivelQualidade = 0;
let janelaInicio = null;
let janelaQuadros = 0;

/** Abre o templo: carrega o Three.js sob demanda (o ateliê segue leve),
 *  monta a cena uma vez, pendura as obras da coleção e pausa a água. */
async function abrirGaleria() {
  if (galeriaAberta) return;
  recolherFerramentas();
  estanteAberta = true; // bloqueia gestos de pintura no ateliê
  galeriaAberta = true;

  // Three.js só entra em cena aqui (import dinâmico): o ateliê nunca o carrega.
  const mod = await import('./galeria.js');
  if (!galeria) {
    galeria = mod.criarGaleria(canvasGaleria);
    navGaleria = mod.instalarNavegacao(canvasGaleria, galeria, reduzMovimento.matches);
  }

  await repovoarTemplo();

  canvasGaleria.hidden = false;
  galeriaUI.hidden = false;
  // Restaura a qualidade cheia a cada abertura (a queda é só da sessão).
  nivelQualidade = 0;
  janelaInicio = null;
  janelaQuadros = 0;
  galeria.definirQualidade(0);
  galeria.redimensionar();
  anteriorGaleria = null;
  loopGaleria = requestAnimationFrame(quadroGaleria);
}

/** Carrega as imagens (do IndexedDB) e (re)pendura a coleção no templo.
 *  Chamada ao abrir e após apagar uma obra. */
async function repovoarTemplo() {
  const lista = await Promise.all(
    obras.map(async (o) => ({
      id: o.id,
      modo: o.modo, // 'agua' | 'cosmos' — define o léxico do poema da galeria
      nome: o.nome,
      haiku: o.haiku,
      ehFundacao: o.ehFundacao,
      imagem: await obterImagem(o),
      // Haiku clássico escolhido — revelado no foco (japonês em colunas + PT).
      haikuId: o.haikuId,
      haikuJp: o.haikuJp,
      haikuJpLinhas: o.haikuJpLinhas,
      haikuPt: o.haikuPt,
      haikuAutor: o.haikuAutor,
    }))
  );
  await galeria.pendurarObras(lista);
  galeriaVazia.hidden = obras.length > 0;
}

function fecharGaleria() {
  if (!galeriaAberta) return;
  galeriaAberta = false;
  estanteAberta = false;
  if (loopGaleria) cancelAnimationFrame(loopGaleria);
  if (navGaleria) navGaleria.sairFoco();
  focoIdAtual = null;
  focoObraEl.classList.remove('visivel');
  focoObraEl.hidden = true;
  canvasGaleria.hidden = true;
  galeriaUI.hidden = true;
  rotuloObra.classList.remove('visivel');
  // A água volta a ser renderizada (o loop do ateliê retoma sozinho).
}

function quadroGaleria(t) {
  const dt = anteriorGaleria === null ? 0 : Math.min((t - anteriorGaleria) / 1000, 1 / 30);
  anteriorGaleria = t;

  // Monitor de FPS REAL (tempo de parede, não o dt limitado): se uma janela
  // de ~1,2s ficar abaixo de 48fps, baixa um nível de qualidade.
  if (janelaInicio === null) janelaInicio = t;
  janelaQuadros++;
  const decorrido = t - janelaInicio;
  if (decorrido >= 1200) {
    const fps = (janelaQuadros * 1000) / decorrido;
    if (fps < 48 && nivelQualidade < 3) galeria.definirQualidade(++nivelQualidade);
    janelaInicio = t;
    janelaQuadros = 0;
  }

  navGaleria.atualizar(dt);
  galeria.atualizarLuz(agoraParaLuz(), dt); // mesma hora do ateliê (?hora)
  galeria.render();

  // Em FOCO (obra clicada): mostra o poema japonês + a janelinha de tradução
  // logo abaixo do quadro; esconde o rótulo flutuante.
  const obraFoco = navGaleria.focoAtual();
  if (obraFoco) {
    if (focoIdAtual !== obraFoco.id) {
      focoIdAtual = obraFoco.id;
      if (obraFoco.haikuId || obraFoco.haikuJp) {
        // Obra com haiku CLÁSSICO: revela o haiku (japonês em 3 colunas) +
        // tradução + autor. As 3 linhas vêm da obra; se faltarem (obra antiga),
        // busca na coleção pelo id; em último caso, o texto corrido.
        const clas = obraFoco.haikuId ? HAIKUS.find((h) => h.id === obraFoco.haikuId) : null;
        const linhas = obraFoco.haikuJpLinhas || (clas && clas.jpLinhas) || [obraFoco.haikuJp];
        const pt = obraFoco.haikuPt || (clas && clas.pt) || '';
        const autor = obraFoco.haikuAutor || (clas && clas.autor) || '';
        focoPoemaJa.innerHTML = linhas.join('<br>');
        focoPoemaPt.innerHTML = pt.replace(/ \/ /g, '<br>');
        focoAutor.textContent = autor ? '— ' + autor : '';
      } else {
        // Fallback (obras antigas): o poema bilíngue gerado da galeria.
        const m = MODOS[obraFoco.modo] || MODOS.agua;
        const poema = gerarPoema(m, hash(obraFoco.id));
        focoPoemaJa.innerHTML = poema.ja.join('<br>');
        focoPoemaPt.innerHTML = poema.pt.join('<br>');
        focoAutor.textContent = '';
      }
      // A fundação (元) é permanente: esconde "apagar". Reset do confirmar.
      botaoApagarFoco.hidden = !!obraFoco.ehFundacao;
      confirmandoApagarFoco = false;
      botaoApagarFoco.textContent = 'apagar';
    }
    focoObraEl.hidden = false;
    focoObraEl.classList.add('visivel');
    rotuloObra.classList.remove('visivel');
  } else {
    if (focoIdAtual !== null) {
      focoIdAtual = null;
      confirmandoApagarFoco = false;
      botaoApagarFoco.textContent = 'apagar';
      focoObraEl.classList.remove('visivel');
      focoObraEl.hidden = true;
    }
    // Rótulo: nome + haiku da obra em foco de proximidade (perto + olhando).
    const foco = galeria.obraEmFoco();
    if (foco) {
      rotuloNome.textContent = (foco.ehFundacao ? '元 ' : '') + foco.nome;
      rotuloHaiku.innerHTML = foco.haiku ? foco.haiku.join('<br>') : '';
      rotuloObra.hidden = false;
      rotuloObra.classList.add('visivel');
    } else {
      rotuloObra.classList.remove('visivel');
    }
  }

  loopGaleria = requestAnimationFrame(quadroGaleria);
}

document.getElementById('voltar-atelie').addEventListener('click', fecharGaleria);
// Afastar do quadro (✕ da janelinha): sai do foco, volta a caminhar.
document.getElementById('foco-fechar').addEventListener('click', () => {
  if (navGaleria) navGaleria.sairFoco();
});

// Baixar a obra em foco (PNG 4K) — mesma rotina da estante 2D.
botaoBaixarFoco.addEventListener('click', () => {
  const f = navGaleria && navGaleria.focoAtual();
  if (!f) return;
  const obra = obras.find((o) => o.id === f.id);
  if (obra) exportarImagem(obra, botaoBaixarFoco, 'baixar');
});

// Apagar a obra em foco: dois toques (clique → "confirmar?" → confirma). A
// fundação não chega aqui (o botão fica escondido). Após apagar, sai do foco
// e repovoa o templo; se esvaziar, mostra o aviso.
botaoApagarFoco.addEventListener('click', async () => {
  const f = navGaleria && navGaleria.focoAtual();
  if (!f || f.ehFundacao) return;
  if (!confirmandoApagarFoco) {
    confirmandoApagarFoco = true;
    botaoApagarFoco.textContent = 'confirmar?';
    return;
  }
  confirmandoApagarFoco = false;
  botaoApagarFoco.textContent = 'apagar';
  const i = obras.findIndex((o) => o.id === f.id);
  if (i >= 0) {
    const [removida] = obras.splice(i, 1);
    idbApagar(removida.id); // libera a imagem do banco (best-effort)
    salvarEstante();
  }
  navGaleria.sairFoco();
  await repovoarTemplo();
});

// Teclado: setas navegam, Esc fecha.
window.addEventListener('keydown', (e) => {
  // No templo (3D): Esc primeiro sai do foco; sem foco, volta ao ateliê.
  if (galeriaAberta) {
    if (e.key === 'Escape') {
      if (navGaleria && navGaleria.focoAtual()) navGaleria.sairFoco();
      else fecharGaleria();
    }
    return;
  }
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

botaoExportar.addEventListener('click', () => exportarImagem(obras[focoEstante], botaoExportar, 'exportar'));

/**
 * Baixa uma obra como PNG. A imagem é a que foi capturada ao guardar
 * (a simulação não guarda estado por obra, então é esta a resolução
 * disponível). Desenha o JPEG armazenado num canvas e exporta PNG —
 * o formato que se espera para salvar arte. Compartilhada pela estante 2D
 * e pelo foco da galeria 3D (cada um passa seu próprio botão/rótulo).
 */
async function exportarImagem(obra, botao, rotulo) {
  if (!obra) return;
  const fonte = await obterImagem(obra);
  if (!fonte) return;

  botao.textContent = 'gerando 4K…';
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
  setTimeout(() => (botao.textContent = rotulo), 1200);
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
 *  trocar não perde a obra (a água absorve, o cosmos emite a mesma luz do
 *  buffer). São motores irmãos: a água roda o solver de fluido; o cosmos é
 *  pintura de luz parada (ver fluido.js e o loop). */
function aplicarModo() {
  fluido.definirModo(modo.render);
  fluido.definirFundo(hexParaRgb(modo.fundo));
  corpo.classList.toggle('modo-cosmos', idModo === 'cosmos');
  // A seleção pode não existir na paleta do novo modo — volta à 1ª tinta.
  const pincelValido = modo.pinceis.some((p) => p.id === selecao);
  if (!pincelValido && (typeof selecao !== 'number' || selecao >= modo.paleta.length)) selecao = 0;
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
