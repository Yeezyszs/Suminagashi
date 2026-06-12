// input.js — traduz gestos (Pointer Events) em comandos para o motor.
//
// Pointer Events unificam mouse, toque e caneta numa só API — por isso o
// site funciona igual no desktop e no celular sem código duplicado.
//
// Este módulo NÃO chama o motor diretamente: ele entrega gestos prontos
// (pingar aqui / arrastar com esta direção e força) via callbacks. Quem
// liga gesto → motor → redesenho é o main. Assim o input também não sabe
// que o motor existe — só sabe geometria de gestos.

/** Distância (px) que separa um TAP de um DRAG. O critério é movimento,
 *  não tempo: um toque longo mas parado ainda pinga uma gota (importante
 *  no celular, onde o dedo sempre demora mais que o clique do mouse). */
export const LIMIAR_ARRASTE = 6;

/** Teto da intensidade z do estilete (px de deslocamento por passo).
 *  Sem teto, um gesto rápido teleportaria a tinta e quebraria a sensação
 *  contemplativa do estilete. */
export const Z_MAXIMO = 14;

/** Quanto da velocidade do gesto vira intensidade z. */
export const GANHO_VELOCIDADE = 0.45;

/** Fator da média móvel exponencial que suaviza a velocidade do gesto.
 *  Em celulares os pointer events chegam em rajadas com intervalos
 *  irregulares, então a velocidade instantânea oscila muito; sem
 *  suavização o estilete daria "trancos" na tinta. Valores menores =
 *  mais suave (e mais "atrasado"). */
export const SUAVIZACAO = 0.3;

/**
 * Instala os handlers de gesto num elemento (o canvas).
 *
 * @param {HTMLElement} alvo
 * @param {{
 *   aoPingar: (x: number, y: number) => void,
 *   aoArrastar: (x: number, y: number, mx: number, my: number, z: number) => void,
 * }} callbacks
 */
export function instalarInput(alvo, { aoPingar, aoArrastar }) {
  // Estado do gesto em andamento (um ponteiro por vez — multitoque fica
  // para depois; o segundo dedo é simplesmente ignorado).
  let ponteiroAtivo = null;
  let inicioX = 0;
  let inicioY = 0;
  let ultimoX = 0;
  let ultimoY = 0;
  let arrastando = false;
  let zSuavizado = 0;

  // Movimentos acumulados desde o último quadro. Pointer events podem
  // chegar mais rápido que 60Hz (mouses gamer chegam a 1000Hz); aplicar a
  // física a cada evento desperdiçaria trabalho que o olho nunca vê. Em
  // vez disso, acumulamos e o main consome uma vez por requestAnimationFrame.
  /** @type {{ x: number, y: number, mx: number, my: number, z: number }[]} */
  const movimentosPendentes = [];

  alvo.addEventListener('pointerdown', (e) => {
    if (ponteiroAtivo !== null) return; // já há um dedo na água
    ponteiroAtivo = e.pointerId;
    // Captura o ponteiro: continuamos recebendo eventos mesmo se o dedo
    // sair por cima da barra de cores no meio do gesto.
    alvo.setPointerCapture(e.pointerId);
    inicioX = ultimoX = e.clientX;
    inicioY = ultimoY = e.clientY;
    arrastando = false;
    zSuavizado = 0;
  });

  alvo.addEventListener('pointermove', (e) => {
    if (e.pointerId !== ponteiroAtivo) return;

    const dx = e.clientX - ultimoX;
    const dy = e.clientY - ultimoY;
    const passo = Math.sqrt(dx * dx + dy * dy);
    if (passo === 0) return;

    // Ainda não decidimos se é tap ou drag? Decide pelo deslocamento
    // total desde o pointerdown.
    if (!arrastando) {
      const totalX = e.clientX - inicioX;
      const totalY = e.clientY - inicioY;
      if (totalX * totalX + totalY * totalY < LIMIAR_ARRASTE * LIMIAR_ARRASTE) {
        return; // ainda dentro da zona de tap; não mexe na tinta
      }
      arrastando = true;
    }

    // Intensidade ∝ tamanho do passo (proxy da velocidade do gesto),
    // suavizada por média móvel exponencial e limitada por Z_MAXIMO.
    const zBruto = Math.min(passo * GANHO_VELOCIDADE, Z_MAXIMO);
    zSuavizado += (zBruto - zSuavizado) * SUAVIZACAO;

    movimentosPendentes.push({
      x: e.clientX,
      y: e.clientY,
      mx: dx / passo, // direção unitária do movimento
      my: dy / passo,
      z: zSuavizado,
    });

    ultimoX = e.clientX;
    ultimoY = e.clientY;
  });

  function terminarGesto(e) {
    if (e.pointerId !== ponteiroAtivo) return;
    // Soltou sem ter virado drag → era um tap: pinga gota.
    if (!arrastando && e.type === 'pointerup') {
      aoPingar(e.clientX, e.clientY);
    }
    ponteiroAtivo = null;
    movimentosPendentes.length = arrastando ? movimentosPendentes.length : 0;
  }

  alvo.addEventListener('pointerup', terminarGesto);
  alvo.addEventListener('pointercancel', terminarGesto);

  /**
   * Consome os movimentos acumulados, entregando cada um ao callback.
   * Chamar uma vez por quadro (no requestAnimationFrame do main).
   * Retorna true se algum movimento foi aplicado (para a dirty flag).
   */
  function processarPendentes() {
    if (movimentosPendentes.length === 0) return false;
    for (const m of movimentosPendentes) {
      aoArrastar(m.x, m.y, m.mx, m.my, m.z);
    }
    movimentosPendentes.length = 0;
    return true;
  }

  return { processarPendentes };
}
