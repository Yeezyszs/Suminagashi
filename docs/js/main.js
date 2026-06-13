// main.js — orquestração: liga o motor de fluido ao input e cuida da UI.
//
// O fluxo por quadro é simples: input acumula gestos → main injeta no
// fluido (splats) → fluido avança a física → exibe. A água é uma simulação
// viva, com momentum de verdade — ela é o relógio do site.

import { mulberry32, entre } from './prng.js';
import { criarFluido } from './fluido.js';
import { instalarInput } from './input.js';

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

// ---------------------------------------------------------------------------
// Gestos → fluido
// ---------------------------------------------------------------------------

const input = instalarInput(canvas, {
  aoPingar(x, y) {
    const raio = entre(rng, RAIO_MINIMO, RAIO_MAXIMO);
    if (selecao === 'agua') {
      // Água dilui o pigmento e empurra — desenha os anéis clássicos.
      fluido.pingarAgua(x, y, raio);
    } else {
      fluido.pingar(x, y, raio, hexParaRgb(corDoSwatch(selecao)));
    }
    esconderDica();
  },
  aoArrastar(x, y, mx, my, velPx) {
    fluido.mexer(x, y, mx, my, velPx, RAIO_ESTILETE);
  },
  aoSoltar() {
    // Nada a fazer: o momentum da própria água continua o movimento.
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

    // A respiração ambiente é decorativa — respeita reduced-motion.
    fluido.passo(dt, reduzMovimento.matches ? 0 : 1);

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
// Início
// ---------------------------------------------------------------------------

montarPaleta();
document.getElementById('lavar').addEventListener('click', lavar);
window.addEventListener('resize', () => fluido.redimensionar());
requestAnimationFrame(quadro);
