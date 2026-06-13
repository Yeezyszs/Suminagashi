// main.js — orquestração: liga o motor de fluido ao input e cuida da UI.
//
// O fluxo por quadro ficou simples: input acumula gestos → main injeta no
// fluido (splats) → fluido avança a física → exibe. Não há mais dirty flag
// nem inércia artificial: a água é uma simulação viva, com momentum de
// verdade — ela é o relógio do site.

import { mulberry32, entre } from './prng.js';
import { criarFluido } from './fluido.js';
import { instalarInput } from './input.js';

// ---------------------------------------------------------------------------
// Paleta provisória (a identidade visual definitiva vem depois — por isso
// tudo em constantes nomeadas, fáceis de trocar num lugar só).
// ---------------------------------------------------------------------------

const COR_PAPEL = '#EFE9DC'; // washi

const PALETA = [
  { nome: 'sumi', cor: '#1C1C1C' },
  { nome: 'índigo', cor: '#1F3A5F' },
  { nome: 'vermelhão', cor: '#C8401F' },
  { nome: 'verde-pinho', cor: '#3E5C43' },
  // "Água" é tinta da cor do papel: ela não pinta nada visível, mas o
  // empurrão radial da gota desloca a tinta existente — alternar tinta e
  // água no mesmo ponto cria os anéis do suminagashi clássico.
  { nome: 'água', cor: COR_PAPEL },
];

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

let corSelecionada = PALETA[0].cor;

// Estado do fade do "lavar": null quando inativo, senão o timestamp inicial.
let inicioLavagem = null;

const reduzMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------------------------------------------------------------------------
// Gestos → fluido
// ---------------------------------------------------------------------------

const input = instalarInput(canvas, {
  aoPingar(x, y) {
    const raio = entre(rng, RAIO_MINIMO, RAIO_MAXIMO);
    fluido.pingar(x, y, raio, hexParaRgb(corSelecionada));
    esconderDica();
  },
  aoArrastar(x, y, mx, my, z) {
    fluido.mexer(x, y, mx, my, z, RAIO_ESTILETE);
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
    fluido.passo(agora / 1000, dt, !reduzMovimento.matches);

    // Lavagem: desbota a tinta para o papel num ritmo que zera a obra em
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
// UI: paleta, lavar, dica efêmera, redimensionamento
// ---------------------------------------------------------------------------

function montarPaleta() {
  const barra = document.getElementById('paleta');
  for (const { nome, cor } of PALETA) {
    const botao = document.createElement('button');
    botao.className = 'cor';
    botao.style.setProperty('--cor', cor);
    botao.setAttribute('aria-label', `tinta ${nome}`);
    botao.title = nome;
    if (cor === corSelecionada) botao.classList.add('ativa');
    botao.addEventListener('click', () => {
      corSelecionada = cor;
      barra.querySelectorAll('.cor').forEach((b) => b.classList.remove('ativa'));
      botao.classList.add('ativa');
    });
    barra.appendChild(botao);
  }
}

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
