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

/** Duração do crescimento de uma gota recém-pingada (ms). Uma gota real
 *  não aparece pronta: ela se espalha pela superfície. A fórmula de Jaffer
 *  compõe (ver deslocar() no engine), então crescer em passos é
 *  matematicamente idêntico a pingar de uma vez — só que fluido. */
const DURACAO_CRESCIMENTO = 350;

/** Raio inicial da "semente" da gota (px), antes do crescimento animado. */
const RAIO_SEMENTE = 3;

/** Inércia do estilete: ao soltar o dedo, a tinta continua deslizando com
 *  a intensidade decaindo por este fator a cada quadro — como água que não
 *  para no instante em que a mão sai. */
const INERCIA_DECAIMENTO = 0.9;

/** Intensidade abaixo da qual a inércia é considerada extinta. */
const INERCIA_MINIMA = 0.15;

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

// Gotas em crescimento: a cada quadro injetamos uma fatia de área até a
// gota atingir o raio alvo. Guardamos os raios AO QUADRADO porque é em r²
// (área) que a fórmula compõe linearmente.
/** @type {{ cx: number, cy: number, r2Semente: number, r2Atual: number, r2Alvo: number, inicio: number }[]} */
const crescimentos = [];

// Corrente residual do estilete: depois que o dedo solta, ela continua
// empurrando a tinta com força decrescente até se extinguir.
/** @type {{ x: number, y: number, mx: number, my: number, z: number } | null} */
let inercia = null;

// Último movimento de arraste — vira a inércia quando o dedo solta.
let ultimoMovimento = null;

const reduzMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------------------------------------------------------------------------
// Gestos → motor
// ---------------------------------------------------------------------------

const input = instalarInput(canvas, {
  aoPingar(x, y) {
    const raio = entre(rng, RAIO_MINIMO, RAIO_MAXIMO);
    if (reduzMovimento.matches) {
      // Sem animações: a gota aparece pronta.
      motor.pingar(x, y, raio, corSelecionada);
    } else {
      // Pinga só a semente; o loop de quadros cresce o resto.
      motor.pingar(x, y, RAIO_SEMENTE, corSelecionada);
      crescimentos.push({
        cx: x,
        cy: y,
        r2Semente: RAIO_SEMENTE * RAIO_SEMENTE,
        r2Atual: RAIO_SEMENTE * RAIO_SEMENTE,
        r2Alvo: raio * raio,
        inicio: performance.now(),
      });
    }
    sujo = true;
    esconderDica();
  },
  aoArrastar(x, y, mx, my, z) {
    motor.estilete(x, y, mx, my, z);
    ultimoMovimento = { x, y, mx, my, z };
    inercia = null; // um gesto novo engole qualquer corrente residual
    // A dirty flag é marcada por processarPendentes() no loop.
  },
  aoSoltar() {
    if (!reduzMovimento.matches && ultimoMovimento) {
      inercia = { ...ultimoMovimento };
    }
  },
});

// ---------------------------------------------------------------------------
// Loop de animação
// ---------------------------------------------------------------------------

// Easing cúbico de saída: rápido no começo, assentando devagar — o ritmo
// natural de uma gota se espalhando (a tensão superficial freia no fim).
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Timestamp do quadro anterior, para calcular o dt da ondulação.
let quadroAnterior = null;

function quadro(agora) {
  // A água respira: a ondulação ambiente roda em todo quadro em que há
  // tinta na bacia (com papel em branco não há o que mover — e o loop
  // volta a ser barato, poupando bateria). O dt é limitado a 50ms: quando
  // a aba volta de segundo plano, o rAF entrega um salto de tempo enorme
  // que teleportaria a tinta em vez de derivá-la.
  if (quadroAnterior !== null && !reduzMovimento.matches && motor.gotas.length > 0) {
    const dt = Math.min((agora - quadroAnterior) / 1000, 0.05);
    motor.ondular(agora / 1000, dt);
    sujo = true;
  }
  quadroAnterior = agora;
  // Aplica os movimentos de estilete acumulados desde o último quadro
  // (uma vez por frame, não por evento — ver comentário no input.js).
  if (input.processarPendentes()) {
    sujo = true;
    esconderDica();
  }

  // Avança as gotas em crescimento. Cada quadro injeta a fatia de área
  // que falta entre o r² atual e o r² desejado pela curva de easing —
  // o deslocamento incremental compõe exatamente (ver engine.deslocar).
  for (let i = crescimentos.length - 1; i >= 0; i--) {
    const c = crescimentos[i];
    const progresso = Math.min((agora - c.inicio) / DURACAO_CRESCIMENTO, 1);
    const r2Desejado = c.r2Semente + (c.r2Alvo - c.r2Semente) * easeOutCubic(progresso);
    const r2Fatia = r2Desejado - c.r2Atual;
    if (r2Fatia > 0) {
      motor.deslocar(c.cx, c.cy, Math.sqrt(r2Fatia));
      c.r2Atual = r2Desejado;
      sujo = true;
    }
    if (progresso >= 1) crescimentos.splice(i, 1);
  }

  // Inércia: a corrente residual continua puxando a tinta, cada vez mais
  // fraca, até se extinguir.
  if (inercia !== null) {
    motor.estilete(inercia.x, inercia.y, inercia.mx, inercia.my, inercia.z);
    inercia.z *= INERCIA_DECAIMENTO;
    sujo = true;
    if (inercia.z < INERCIA_MINIMA) inercia = null;
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
  // Interrompe animações pendentes: não faz sentido crescer ou arrastar
  // tinta que está indo embora.
  crescimentos.length = 0;
  inercia = null;
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
