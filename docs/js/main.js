// main.js — orquestração: liga o motor de fluido ao input e cuida da UI.
//
// O fluxo por quadro é simples: input acumula gestos → main injeta no
// fluido (splats) → fluido avança a física → exibe. A água é uma simulação
// viva, com momentum de verdade — ela é o relógio do site.

import { mulberry32, entre } from './prng.js';
import { criarFluido } from './fluido.js';
import { instalarInput } from './input.js';
import { extrairTema, calcularCalma, mapearCalma } from './ritual.js';
import {
  cicloDeLuz,
  extrairTomFundacao,
  comporAtmosfera,
  corDaAtmosfera,
} from './luz.js';

// ---------------------------------------------------------------------------
// Paleta (10 tintas + água), em constantes nomeadas e fáceis de trocar.
// As cores foram escolhidas para misturar bem em densidade óptica
// (Beer-Lambert): pares clássicos como amarelo-ouro + azul-céu → verde,
// vermelhão + amarelo-ouro → laranja.
// ---------------------------------------------------------------------------

const COR_PAPEL = '#EFE9DC'; // washi

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

/** Chave do localStorage com as cores personalizadas ({ índice: '#hex' }). */
const CHAVE_PALETA = 'paleta.v1';

/** Long-press num swatch (ms) abre o editor de cor. */
const DURACAO_LONGPRESS = 450;

/** Faixa de raio das gotas (px). A variação aleatória vem do PRNG. */
const RAIO_MINIMO = 18;
const RAIO_MAXIMO = 48;

/** Raio de influência do estilete (px). Largo e gentil: correnteza ampla
 *  que dobra a tinta em espirais suaves, não um jato fino. */
const RAIO_ESTILETE = 70;

/** Duração do fade do botão lavar (ms). */
const DURACAO_LAVAR = 600;

/** Passo máximo da física (s). Quando a aba volta de segundo plano, o
 *  requestAnimationFrame entrega um salto de tempo enorme — sem este teto
 *  a advecção atravessaria a bacia inteira num único passo. */
const DT_MAXIMO = 1 / 30;

// --- ritual de entrada ------------------------------------------------------

/** Chave única do ritual no localStorage (JSON com tema, calma, miniatura). */
const CHAVE_RITUAL = 'ritual.v1';

/** Chave do viés de tom da fundação (camada 2 da luz). */
const CHAVE_FUNDACAO = 'fundacao.v1';

/** Gestos mínimos antes que a obra possa assentar. */
const GESTOS_MINIMOS = 3;

/** Inatividade (ms) que inicia o assentamento. */
const INATIVIDADE_ASSENTAR = 10000;

/** Duração (ms) do assentamento: a água se aquieta gradualmente. */
const DURACAO_ASSENTAMENTO = 3000;

/** Largura (px) da miniatura da fundação gravada no localStorage. */
const LARGURA_MINIATURA = 256;

/** Convite do ritual e dica do modo livre. */
const TEXTO_CONVITE = 'pinte. o site vai se vestir de você.';
const TEXTO_DICA = 'toque para pingar · arraste para mover a tinta';

// ---------------------------------------------------------------------------
// localStorage com rede de proteção: em modo anônimo restrito o acesso
// lança exceção — o recurso passa a valer só para a sessão, sem erro.
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
    /* sem armazenamento: segue valendo só em memória */
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

// Na v1 o seed é o relógio; num modo futuro virá de uma URL compartilhável.
const seed = Date.now();
const rng = mulberry32(seed);

const canvas = document.getElementById('agua');
let fluido;
try {
  fluido = criarFluido(canvas, hexParaRgb(COR_PAPEL));
} catch (e) {
  // Sem WebGL2 não há simulação; avisa em vez de deixar a tela morta.
  document.getElementById('dica').textContent =
    'este navegador não suporta a simulação de água (WebGL2)';
  throw e;
}

// Cores personalizadas sobrepostas à paleta padrão.
const coresPersonalizadas = lerArmazenado(CHAVE_PALETA) || {};

/** Cor efetiva de um swatch (personalizada, se houver). */
function corDoSwatch(indice) {
  return coresPersonalizadas[indice] || PALETA[indice].cor;
}

// Seleção atual: um índice da PALETA, ou 'agua'.
let selecao = 0;

// Estado do fade do "lavar": null quando inativo, senão o timestamp inicial.
let inicioLavagem = null;

const reduzMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');

// --- estado do ritual -------------------------------------------------------

// O usuário está no ritual de entrada? (primeira visita, sem tema salvo)
let emRitual = false;

// Telemetria do gesto durante o ritual — vira o escalar "calma" no fim.
// Nada disso sai do navegador.
const telemetria = { inicio: 0, taps: 0, drags: 0, somaVel: 0, nVel: 0 };

// Velocidades do arraste em andamento (para a média do gesto no aoSoltar).
let velArrasteAtual = 0;
let nVelArrasteAtual = 0;

// Última interação (qualquer gesto na água) — relógio da inatividade.
let ultimaInteracao = performance.now();

// Assentamento em andamento: timestamp inicial, ou null.
let inicioAssentamento = null;

// Multiplicador do ritmo da água vindo do tema salvo (1 = neutro).
let fatorOndulacaoTema = 1;

// --- atmosfera (sistema de luz) ---------------------------------------------

// Viés de tom da fundação (camada 2): null = sala ainda sem alma.
let tomFundacao = lerArmazenado(CHAVE_FUNDACAO);

const overlayAtmosfera = document.getElementById('atmosfera');

// Hora forçada por ?hora=HH:MM — só para testar/validar o ciclo de luz
// (critério de aceite nº 2). Sem o parâmetro, usa o relógio real.
const horaForcada = new URLSearchParams(location.search).get('hora');

/** O instante usado pelo ciclo de luz (real, ou forçado para teste). */
function agoraParaLuz() {
  if (horaForcada === null) return new Date();
  const [hh, mm] = horaForcada.split(':');
  const d = new Date();
  d.setHours(Number(hh) || 0, Number(mm) || 0, 0, 0);
  return d;
}

/** Recalcula a luz da sala e a aplica ao overlay. O CSS faz a transição
 *  suave; por isso basta chamar a cada ~60s (a luz é minuto a minuto). */
function atualizarAtmosfera() {
  const atm = comporAtmosfera(cicloDeLuz(agoraParaLuz()), tomFundacao);
  const { centro, borda } = corDaAtmosfera(atm);
  overlayAtmosfera.style.setProperty('--atm-centro', centro);
  overlayAtmosfera.style.setProperty('--atm-borda', borda);
}

// ---------------------------------------------------------------------------
// Gestos → fluido
// ---------------------------------------------------------------------------

/** Qualquer gesto na água: alimenta o relógio de inatividade do ritual e
 *  cancela um assentamento em andamento (a água volta a acordar). */
function registrarInteracao() {
  ultimaInteracao = performance.now();
  if (inicioAssentamento !== null) {
    inicioAssentamento = null;
    document.body.classList.remove('assentando');
  }
}

const input = instalarInput(canvas, {
  aoPingar(x, y) {
    const raio = entre(rng, RAIO_MINIMO, RAIO_MAXIMO);
    if (selecao === 'agua') {
      // Água dilui o pigmento e empurra — desenha os anéis clássicos.
      fluido.pingarAgua(x, y, raio);
    } else {
      fluido.pingar(x, y, raio, hexParaRgb(corDoSwatch(selecao)));
    }
    if (emRitual) telemetria.taps++;
    registrarInteracao();
    esconderDica();
  },
  aoArrastar(x, y, mx, my, velPx) {
    fluido.mexer(x, y, mx, my, velPx, RAIO_ESTILETE);
    velArrasteAtual += velPx;
    nVelArrasteAtual++;
    registrarInteracao();
  },
  aoSoltar() {
    // O momentum da água continua o movimento sozinho; aqui só fechamos a
    // contabilidade do gesto (um arraste = um gesto, com sua vel. média).
    if (emRitual && nVelArrasteAtual > 0) {
      telemetria.drags++;
      telemetria.somaVel += velArrasteAtual / nVelArrasteAtual;
      telemetria.nVel++;
    }
    velArrasteAtual = 0;
    nVelArrasteAtual = 0;
  },
});

// ---------------------------------------------------------------------------
// Loop de animação
// ---------------------------------------------------------------------------

let quadroAnterior = null;

function quadro(agora) {
  if (input.processarPendentes()) esconderDica();

  if (quadroAnterior !== null) {
    const dt = Math.min((agora - quadroAnterior) / 1000, DT_MAXIMO);

    // --- ritual: a obra assenta após gestos suficientes + inatividade ----
    let fatorOndulacao = fatorOndulacaoTema;
    if (emRitual) {
      const gestos = telemetria.taps + telemetria.drags;
      if (
        inicioAssentamento === null &&
        gestos >= GESTOS_MINIMOS &&
        agora - ultimaInteracao > INATIVIDADE_ASSENTAR
      ) {
        if (reduzMovimento.matches) {
          // Sem animação longa: o assentamento é um corte.
          concluirRitual();
        } else {
          inicioAssentamento = agora;
          // Sem countdown: só a UI esmaecendo sinaliza o momento.
          document.body.classList.add('assentando');
        }
      }
      if (inicioAssentamento !== null) {
        const progresso = (agora - inicioAssentamento) / DURACAO_ASSENTAMENTO;
        // A respiração desacelera até a água se aquietar por completo.
        fatorOndulacao = Math.max(0, 1 - progresso);
        if (progresso >= 1) {
          inicioAssentamento = null;
          document.body.classList.remove('assentando');
          concluirRitual();
        }
      }
    }

    // A respiração ambiente é decorativa — respeita reduced-motion.
    fluido.passo(dt, reduzMovimento.matches ? 0 : fatorOndulacao);

    // Lavagem: dilui a densidade num ritmo que zera a obra em
    // DURACAO_LAVAR (fração constante por segundo ⇒ decaimento suave).
    if (inicioLavagem !== null) {
      const progresso = (agora - inicioLavagem) / DURACAO_LAVAR;
      if (progresso >= 1) {
        fluido.desbotar(1);
        inicioLavagem = null;
      } else {
        // Fator por quadro tal que o produto acumulado em 600ms ≈ zero
        // tinta restante (1 - f)^(T/dt) ≈ 0.1% — visualmente limpo.
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
  if (reduzMovimento.matches) {
    fluido.desbotar(1); // sem fade: limpeza imediata
  } else {
    inicioLavagem = performance.now();
  }
  // Durante o ritual: lavar não conta como gesto nem zera a contagem,
  // mas reinicia o relógio de inatividade (senão a bacia recém-lavada
  // assentaria no segundo seguinte, vazia).
  registrarInteracao();
}

// ---------------------------------------------------------------------------
// Ritual de entrada: conclusão, tema e persistência
// ---------------------------------------------------------------------------

/**
 * A água assentou: extrai o tema da obra e do gesto, veste o site e
 * grava a fundação. Se a obra for tímida demais (tema null), segue para
 * o modo livre sem cerimônia — e sem gravar, para que a próxima visita
 * ofereça o ritual de novo.
 */
function concluirRitual() {
  emRitual = false;

  const amostra = fluido.capturar(64);
  const tema = extrairTema(amostra.pixels, amostra.w, amostra.h, hexParaRgb(COR_PAPEL));
  if (!tema) return;

  const minutos = Math.max((performance.now() - telemetria.inicio) / 60000, 1 / 60);
  const gestos = telemetria.taps + telemetria.drags;
  const calma = calcularCalma({
    gestosPorMinuto: gestos / minutos,
    velocidadeMedia: telemetria.nVel ? telemetria.somaVel / telemetria.nVel : 0,
    proporcaoTap: gestos ? telemetria.taps / gestos : 1,
  });

  aplicarTema(tema, calma, true);

  // A fundação também define o TOM da sala (camada 2 da luz): a primeira
  // pintura é o ar que a sala respira. Reaproveita a mesma amostra 64px.
  tomFundacao = extrairTomFundacao(amostra.pixels, amostra.w, amostra.h, hexParaRgb(COR_PAPEL));
  gravarArmazenado(CHAVE_FUNDACAO, tomFundacao);
  atualizarAtmosfera();

  // A fundação: miniatura da obra que acabou de vestir o site.
  const miniatura = capturaParaDataUrl(fluido.capturar(LARGURA_MINIATURA));
  gravarArmazenado(CHAVE_RITUAL, {
    tema,
    calma,
    miniatura,
    timestamp: Date.now(),
    gestos,
  });
  mostrarSelo(miniatura);

  // "este é o seu lugar." — breve, discreto, e some sozinho.
  const aviso = document.getElementById('aviso');
  aviso.hidden = false;
  requestAnimationFrame(() => aviso.classList.add('visivel'));
  setTimeout(() => aviso.classList.remove('visivel'), 4200);
}

/**
 * Veste o site com o tema: cores da UI via CSS custom properties, papel
 * da simulação com leve tint, e o temperamento (calma) no ritmo da água
 * e na duração das transições.
 */
function aplicarTema(tema, calma, comTransicao) {
  const { ritmoOndulacao, duracaoTransicaoMs } = mapearCalma(calma);
  const raiz = document.documentElement;

  // Transição suave só quando o tema muda diante do usuário (no retorno,
  // o site já abre vestido — sem teatro).
  raiz.style.setProperty(
    '--duracao-tema',
    comTransicao && !reduzMovimento.matches ? `${duracaoTransicaoMs}ms` : '0ms'
  );
  raiz.style.setProperty('--papel', tema.fundo);
  raiz.style.setProperty('--tinta', tema.acento);

  fluido.definirPapel(hexParaRgb(tema.papel));
  fluido.definirRitmo(ritmoOndulacao);
  fatorOndulacaoTema = 1; // o ritmo já embute o temperamento
}

/** Pixels do capturar() → dataURL JPEG (linhas do WebGL vêm de baixo
 *  para cima; aqui o eixo y é invertido ao desenhar). */
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
  return tela.toDataURL('image/jpeg', 0.72);
}

// --- selo da fundação -------------------------------------------------------

function mostrarSelo(miniatura) {
  const selo = document.getElementById('selo');
  document.getElementById('selo-img').src = miniatura;
  selo.hidden = false;
}

function refazerRitual() {
  gravarArmazenado(CHAVE_RITUAL, null);
  gravarArmazenado(CHAVE_FUNDACAO, null);
  tomFundacao = null;
  atualizarAtmosfera(); // a sala volta a ser neutra (sem alma)
  document.getElementById('selo').hidden = true;
  document.getElementById('popover-selo').hidden = true;

  // Volta ao neutro e recomeça o fluxo do zero.
  const raiz = document.documentElement;
  raiz.style.setProperty('--duracao-tema', '0ms');
  raiz.style.removeProperty('--papel');
  raiz.style.removeProperty('--tinta');
  fluido.definirPapel(hexParaRgb(COR_PAPEL));
  fluido.definirRitmo(1);
  fluido.desbotar(1);

  telemetria.inicio = performance.now();
  telemetria.taps = telemetria.drags = telemetria.somaVel = telemetria.nVel = 0;
  emRitual = true;
  ultimaInteracao = performance.now();

  const dica = document.getElementById('dica');
  dica.textContent = TEXTO_CONVITE;
  dica.classList.remove('escondida');
  dicaEscondida = false;
}

// ---------------------------------------------------------------------------
// UI: paleta com long-press, lavar, dica efêmera, redimensionamento
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

    // Long-press abre o editor de cor; toque curto seleciona. Aqui a
    // decisão é por TEMPO (segurar parado ~450ms), diferente do canvas,
    // onde tap/drag se decide por movimento — são gestos de natureza
    // diferente: lá pintura, aqui um "quero mexer nisso".
    let timerLongPress = null;
    let foiLongPress = false;

    botao.addEventListener('pointerdown', () => {
      foiLongPress = false;
      timerLongPress = setTimeout(() => {
        foiLongPress = true;
        abrirEditorCor(indice, botao);
      }, DURACAO_LONGPRESS);
    });
    const cancelarTimer = () => clearTimeout(timerLongPress);
    botao.addEventListener('pointerleave', cancelarTimer);
    botao.addEventListener('pointercancel', cancelarTimer);
    botao.addEventListener('pointerup', cancelarTimer);

    botao.addEventListener('click', () => {
      if (foiLongPress) return; // o long-press não conta como seleção
      selecionar(indice);
    });

    barra.appendChild(botao);
  });

  // Água: swatch especial — não personalizável, ela é o próprio papel.
  const agua = document.createElement('button');
  agua.className = 'cor agua';
  agua.style.setProperty('--cor', COR_PAPEL);
  agua.setAttribute('aria-label', 'água');
  agua.title = 'água';
  if (selecao === 'agua') agua.classList.add('ativa');
  agua.addEventListener('click', () => selecionar('agua'));
  barra.appendChild(agua);
}

function selecionar(novaSelecao) {
  selecao = novaSelecao;
  document.querySelectorAll('#paleta .cor').forEach((b) => {
    const dele = b.classList.contains('agua') ? 'agua' : Number(b.dataset.indice);
    b.classList.toggle('ativa', dele === selecao);
  });
}

function abrirEditorCor(indice, botaoAncora) {
  indiceEmEdicao = indice;
  entradaCor.value = corDoSwatch(indice);
  botaoRestaurar.hidden = !coresPersonalizadas[indice];

  // Posiciona o editor logo acima do swatch pressionado, contido na tela.
  const r = botaoAncora.getBoundingClientRect();
  editorCor.hidden = false;
  const largura = editorCor.offsetWidth;
  const esquerda = Math.max(
    8,
    Math.min(r.left + r.width / 2 - largura / 2, window.innerWidth - largura - 8)
  );
  editorCor.style.left = `${esquerda}px`;
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

// Tocar fora do editor fecha-o (o canvas continua recebendo o gesto).
window.addEventListener('pointerdown', (e) => {
  if (!editorCor.hidden && !editorCor.contains(e.target)) fecharEditorCor();
});

let dicaEscondida = false;
function esconderDica() {
  if (dicaEscondida) return;
  dicaEscondida = true;
  document.getElementById('dica').classList.add('escondida');
}

// ---------------------------------------------------------------------------
// Início: primeira visita entra no ritual; retorno abre já vestido
// ---------------------------------------------------------------------------

const fundacao = lerArmazenado(CHAVE_RITUAL);
if (fundacao && fundacao.tema) {
  aplicarTema(fundacao.tema, fundacao.calma ?? 0.5, false);
  if (fundacao.miniatura) mostrarSelo(fundacao.miniatura);
  document.getElementById('dica').textContent = TEXTO_DICA;
} else {
  emRitual = true;
  telemetria.inicio = performance.now();
  document.getElementById('dica').textContent = TEXTO_CONVITE;
}

// Selo → popover com "refazer o ritual" / "fechar".
const popoverSelo = document.getElementById('popover-selo');
document.getElementById('selo').addEventListener('click', () => {
  popoverSelo.hidden = !popoverSelo.hidden;
});
document.getElementById('refazer-ritual').addEventListener('click', refazerRitual);
document.getElementById('fechar-selo').addEventListener('click', () => {
  popoverSelo.hidden = true;
});

montarPaleta();
document.getElementById('lavar').addEventListener('click', lavar);
window.addEventListener('resize', () => fluido.redimensionar());

// A luz da sala: aplica agora e segue minuto a minuto.
atualizarAtmosfera();
setInterval(atualizarAtmosfera, 60000);

requestAnimationFrame(quadro);
