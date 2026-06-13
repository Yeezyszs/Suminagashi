// prng.js — gerador pseudo-aleatório seedável (mulberry32).
//
// Por que não usar Math.random()? Porque Math.random() não aceita seed:
// cada execução produz uma sequência diferente e irreproduzível. Um modo
// futuro do site vai recriar obras inteiras a partir de um seed
// compartilhável (ex.: numa URL) — isso só funciona se TODA aleatoriedade
// do projeto passar por um gerador determinístico desde o primeiro dia.
// Determinismo não dá para "adicionar depois": qualquer Math.random()
// esquecido no meio do caminho quebra a reprodução inteira.
//
// O mulberry32 é um PRNG minúsculo (uma linha de estado de 32 bits) com
// qualidade estatística boa o suficiente para arte generativa — não serve
// para criptografia, mas aqui só precisamos de variação visual agradável.

/**
 * Cria um gerador pseudo-aleatório com o seed dado.
 * Retorna uma função que, a cada chamada, devolve um número em [0, 1).
 *
 * @param {number} seed - inteiro de 32 bits que determina toda a sequência
 * @returns {() => number}
 */
export function mulberry32(seed) {
  // ">>> 0" força o seed a virar um inteiro de 32 bits sem sinal,
  // garantindo comportamento idêntico para qualquer número de entrada.
  let estado = seed >>> 0;

  return function () {
    // Cada passo mistura os bits do estado com multiplicações e XORs
    // (constantes escolhidas pelo autor do algoritmo, Tommy Ettinger,
    // para espalhar bem os bits). O resultado final é dividido por 2³²
    // para cair no intervalo [0, 1), igual ao Math.random().
    estado = (estado + 0x6d2b79f5) | 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Conveniência: número aleatório no intervalo [min, max).
 *
 * @param {() => number} rng - gerador criado por mulberry32
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function entre(rng, min, max) {
  return min + rng() * (max - min);
}
