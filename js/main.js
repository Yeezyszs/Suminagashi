// main.js — orquestração: liga motor, renderer e input, e cuida da UI.
//
// É o único módulo que conhece todos os outros. O fluxo por quadro:
//   input acumula gestos → main aplica no motor → dirty flag → renderer.

import { mulberry32, entre } from './prng.js';
import { criarMotor } from './engine.js';
import { criarRenderer } from './renderer.js';
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
  // "Água" é tinta da cor do papel: ela não cobre nada visualmente, mas
  // EMPURRA a tinta existente — é o que cria os anéis concêntricos do
  // suminagashi clássico (alterne tinta e água no mesmo ponto para ver).
  { nome: 'água', cor: COR_PAPEL },
];

/** Faixa de raio das gotas (px). A variação aleatória vem do PRNG. */
const RAIO_MINIMO = 18;
const RAIO_MAXIMO = 48;

/** Duração do fade do botão lavar (ms). */
const DURACAO_LAVAR = 600;

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

// Na v1 o seed é o relógio; num modo futuro virá de uma URL compartilhável.
const seed = Date.now();
const rng = mulberry32(seed);

const motor = criarMotor();
const canvas = document.getElementById('agua');
const renderer = criarRenderer(canvas, COR_PAPEL);

let corSelecionada = PALETA[0].cor;

// Dirty flag: só redesenhamos quando o estado muda. O loop de rAF roda
// sempre, mas barato — um booleano por quadro quando nada acontece. Isso
// poupa bateria no celular sem a complexidade de parar/religar o loop.
let sujo = true;

// Estado do fade do "lavar": null quando inativo, senão o timestamp inicial.
let inicioLavagem = null;

const reduzMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------------------------------------------------------------------------
// Gestos → motor
// ---------------------------------------------------------------------------

const input = instalarInput(canvas, {
  aoPingar(x, y) {
    const raio = entre(rng, RAIO_MINIMO, RAIO_MAXIMO);
    motor.pingar(x, y, raio, corSelecionada);
    sujo = true;
    esconderDica();
  },
  aoArrastar(x, y, mx, my, z) {
    motor.estilete(x, y, mx, my, z);
    // A dirty flag é marcada por processarPendentes() no loop.
  },
});

// ---------------------------------------------------------------------------
// Loop de animação
// ---------------------------------------------------------------------------

function quadro(agora) {
  // Aplica os movimentos de estilete acumulados desde o último quadro
  // (uma vez por frame, não por evento — ver comentário no input.js).
  if (input.processarPendentes()) {
    sujo = true;
    esconderDica();
  }

  // Animação de lavagem em andamento?
  if (inicioLavagem !== null) {
    const progresso = Math.min((agora - inicioLavagem) / DURACAO_LAVAR, 1);
    renderer.desenhar(motor.gotas);
    renderer.desenharVeu(progresso);
    if (progresso >= 1) {
      inicioLavagem = null;
      motor.limpar();
      sujo = true;
    }
  } else if (sujo) {
    renderer.desenhar(motor.gotas);
    sujo = false;
  }

  requestAnimationFrame(quadro);
}

function lavar() {
  if (motor.gotas.length === 0 || inicioLavagem !== null) return;
  if (reduzMovimento.matches) {
    // Com prefers-reduced-motion ativo, nada de fade: limpeza imediata.
    motor.limpar();
    sujo = true;
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

function aoRedimensionar() {
  renderer.redimensionar();
  sujo = true;
}

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

montarPaleta();
document.getElementById('lavar').addEventListener('click', lavar);
window.addEventListener('resize', aoRedimensionar);
aoRedimensionar();
requestAnimationFrame(quadro);
