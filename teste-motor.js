// teste-motor.js — verificação rápida do motor em Node, sem framework.
// Rodar: node teste-motor.js
//
// O motor é matemática pura (zero DOM), então dá para testá-lo fora do
// navegador com valores conhecidos das fórmulas. Se algo falhar, o processo
// sai com código 1.

import { criarMotor, VERTICES_INICIAIS, MAX_GOTAS, MAX_VERTICES, LAMBDA_ESTILETE } from './js/engine.js';
import { mulberry32 } from './js/prng.js';

let falhas = 0;

function verifica(nome, condicao, detalhe = '') {
  if (condicao) {
    console.log(`  ok  ${nome}`);
  } else {
    console.error(`FALHA ${nome} ${detalhe}`);
    falhas++;
  }
}

function aproxIgual(a, b, tol = 1e-4) {
  return Math.abs(a - b) <= tol;
}

// ---------------------------------------------------------------------------
console.log('1. PRNG determinístico');
{
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  verifica('mesmo seed → mesma sequência', seqA.every((v, i) => v === seqB[i]));
  verifica('valores em [0, 1)', seqA.every((v) => v >= 0 && v < 1));
}

// ---------------------------------------------------------------------------
console.log('2. Pingar: fórmula de deslocamento com valores conhecidos');
{
  // Gota A em (0,0) raio 10. Depois gota B em (0,0) raio 10.
  // Um vértice de A que estava a distância d=10 do centro de B deve ir
  // para sqrt(d² + r²) = sqrt(100 + 100) = sqrt(200) ≈ 14.1421.
  const motor = criarMotor();
  motor.pingar(0, 0, 10, '#000');
  motor.pingar(0, 0, 10, '#fff');

  const gotaA = motor.gotas[0];
  // O vértice 0 do círculo inicial fica no ângulo 0 → (10, 0) antes do empurrão.
  const x = gotaA.pontos[0];
  const y = gotaA.pontos[1];
  const dist = Math.sqrt(x * x + y * y);
  verifica(
    'vértice a d=10 empurrado para sqrt(200)',
    aproxIgual(dist, Math.sqrt(200)),
    `(obtido ${dist})`
  );

  // Preservação de área: TODO vértice de A deve continuar equidistante do
  // centro (o círculo empurrado vira um círculo maior, não uma forma torta).
  let todosNaMesmaDistancia = true;
  for (let v = 0; v < gotaA.n; v++) {
    const vx = gotaA.pontos[v * 2];
    const vy = gotaA.pontos[v * 2 + 1];
    if (!aproxIgual(Math.sqrt(vx * vx + vy * vy), Math.sqrt(200), 1e-3)) {
      todosNaMesmaDistancia = false;
      break;
    }
  }
  verifica('círculo empurrado continua circular', todosNaMesmaDistancia);
}

// ---------------------------------------------------------------------------
console.log('3. Pingar no mesmo ponto não explode (proteção epsilon)');
{
  const motor = criarMotor();
  for (let i = 0; i < 10; i++) motor.pingar(100, 100, 30, i % 2 ? '#000' : '#fff');
  let finito = true;
  for (const g of motor.gotas) {
    for (let i = 0; i < g.n * 2; i++) {
      if (!Number.isFinite(g.pontos[i])) finito = false;
    }
  }
  verifica('10 gotas no mesmo ponto → coordenadas todas finitas', finito);
}

// ---------------------------------------------------------------------------
console.log('4. Estilete: decaimento com a distância');
{
  // Vértice exatamente sob o dedo (d≈0) deve se mover ~z;
  // vértice a d=λ deve se mover z·(1/2)² = z/4.
  const motor = criarMotor();
  motor.pingar(0, 0, 5, '#000'); // círculo pequeno em volta da origem

  // Pega a posição inicial do vértice 0: (5, 0).
  const antes = [motor.gotas[0].pontos[0], motor.gotas[0].pontos[1]];

  // Estilete em cima do vértice, movendo em +y com z=8.
  motor.estilete(antes[0], antes[1], 0, 1, 8);

  const depois = [motor.gotas[0].pontos[0], motor.gotas[0].pontos[1]];
  verifica('vértice sob o dedo move ≈ z', aproxIgual(depois[1] - antes[1], 8), `(obtido ${depois[1] - antes[1]})`);

  // Agora um vértice a distância λ do dedo.
  const motor2 = criarMotor();
  motor2.pingar(0, 0, 5, '#000');
  const v0 = [motor2.gotas[0].pontos[0], motor2.gotas[0].pontos[1]]; // (5, 0)
  motor2.estilete(v0[0] + LAMBDA_ESTILETE, v0[1], 0, 1, 8);
  const dy = motor2.gotas[0].pontos[1] - v0[1];
  verifica('vértice a d=λ move ≈ z/4', aproxIgual(dy, 2), `(obtido ${dy})`);
}

// ---------------------------------------------------------------------------
console.log('5. Reamostragem: subdivide sem rasgar e respeita o teto');
{
  const motor = criarMotor();
  motor.pingar(0, 0, 20, '#000');
  // Muitas gotas grandes ao redor esticam bastante a primeira.
  for (let i = 0; i < 30; i++) motor.pingar(0, 0, 40, '#fff');

  const primeira = motor.gotas[0];
  verifica('gota deformada ganhou vértices', primeira.n > VERTICES_INICIAIS, `(n=${primeira.n})`);

  let dentroDoTeto = motor.gotas.every((g) => g.n <= MAX_VERTICES);
  verifica('nenhuma gota passa de MAX_VERTICES', dentroDoTeto);
}

// ---------------------------------------------------------------------------
console.log('6. Teto de gotas simultâneas');
{
  const motor = criarMotor();
  for (let i = 0; i < MAX_GOTAS + 25; i++) motor.pingar(i * 3, 0, 10, '#000');
  verifica(`lista limitada a ${MAX_GOTAS} gotas`, motor.gotas.length === MAX_GOTAS, `(obtido ${motor.gotas.length})`);
}

// ---------------------------------------------------------------------------
console.log('7. Desempenho aproximado (cenário do brief: 60 gotas)');
{
  const motor = criarMotor();
  const rng = mulberry32(7);
  for (let i = 0; i < 60; i++) motor.pingar(rng() * 800, rng() * 600, 18 + rng() * 30, '#000');

  // Mede o custo de um passo de estilete (a operação que roda a cada frame
  // durante o arraste). Precisa caber folgado em 16ms.
  const inicio = performance.now();
  const PASSOS = 100;
  for (let i = 0; i < PASSOS; i++) motor.estilete(400 + i, 300, 1, 0, 5);
  const mediaMs = (performance.now() - inicio) / PASSOS;
  verifica(`passo de estilete em ${mediaMs.toFixed(2)}ms (< 8ms)`, mediaMs < 8);
}

// ---------------------------------------------------------------------------
console.log('');
if (falhas === 0) {
  console.log('Todos os testes passaram.');
} else {
  console.error(`${falhas} teste(s) falharam.`);
  process.exit(1);
}
