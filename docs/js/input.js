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

/** Teto da rapidez do gesto considerada (px/s). Movimentos mais rápidos
 *  que isso são tratados como este teto — protege contra velocidades
 *  absurdas vindas de eventos com timestamps colados. */
export const VELOCIDADE_MAXIMA = 2500;

/** Fator da média móvel exponencial que suaviza a velocidade do gesto.
 *  Em celulares os pointer events chegam em rajadas com intervalos
 *  irregulares, então a velocidade instantânea oscila muito; sem
 *  suavização o estilete daria "trancos" na tinta. Valores menores =
 *  mais suave (e mais "atrasado"). */
export const SUAVIZACAO = 0.3;

/** Comprimento máximo (px) de cada sub-passo do estilete. Um gesto rápido
 *  pode percorrer 40px entre dois pointer events; aplicar a deformação de
 *  uma vez nesse salto faria a tinta "teleportar" em degraus visíveis.
 *  Dividindo o segmento em sub-passos curtos, o estilete passa por TODOS
 *  os pontos do caminho e a tinta flui contínua, sem importar a
 *  velocidade do dedo. */
export const SUBPASSO = 8;

/**
 * Instala os handlers de gesto num elemento (o canvas).
 *
 * @param {HTMLElement} alvo
 * @param {{
 *   aoPingar: (x: number, y: number) => void,
 *   aoArrastar: (x: number, y: number, mx: number, my: number, velPx: number) => void,
 *   aoSoltar: () => void,
 * }} callbacks - aoArrastar recebe a posição, a direção unitária do gesto
 *   e a rapidez REAL do dedo em px/s (suavizada); aoSoltar dispara ao fim
 *   de um arraste (não de um tap).
 */
export function instalarInput(alvo, { aoPingar, aoArrastar, aoSoltar }) {
  // Estado do gesto em andamento (um ponteiro por vez — multitoque fica
  // para depois; o segundo dedo é simplesmente ignorado).
  let ponteiroAtivo = null;
  let inicioX = 0;
  let inicioY = 0;
  let ultimoX = 0;
  let ultimoY = 0;
  let arrastando = false;
  let ultimoTempo = 0;
  let inicioTempo = 0; // quando o toque começou (p/ distinguir tap curto)
  let rapidezSuavizada = 0;

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
    ultimoTempo = inicioTempo = e.timeStamp;
    arrastando = false;
    rapidezSuavizada = 0;
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

    // Rapidez REAL do gesto (px/s), pelo timestamp do evento, suavizada
    // por média móvel exponencial: o estilete "pega embalo" e desacelera
    // gradualmente em vez de responder em trancos.
    const dtEvento = Math.max((e.timeStamp - ultimoTempo) / 1000, 0.001);
    const rapidezBruta = Math.min(passo / dtEvento, VELOCIDADE_MAXIMA);
    rapidezSuavizada += (rapidezBruta - rapidezSuavizada) * SUAVIZACAO;
    ultimoTempo = e.timeStamp;

    // Divide o segmento em sub-passos curtos (ver SUBPASSO), todos com a
    // mesma velocidade: o estilete toca TODOS os pontos do caminho, sem
    // importar quantos eventos o navegador disparou.
    const mx = dx / passo;
    const my = dy / passo;
    const numSubpassos = Math.max(1, Math.ceil(passo / SUBPASSO));
    const comprimentoSub = passo / numSubpassos;

    for (let s = 1; s <= numSubpassos; s++) {
      movimentosPendentes.push({
        x: ultimoX + mx * comprimentoSub * s,
        y: ultimoY + my * comprimentoSub * s,
        mx,
        my,
        z: rapidezSuavizada,
      });
    }

    ultimoX = e.clientX;
    ultimoY = e.clientY;
  });

  function terminarGesto(e) {
    if (e.pointerId !== ponteiroAtivo) return;
    if (!arrastando && e.type === 'pointerup') {
      // Soltou sem ter virado drag → era um tap: pinga gota. A duração
      // distingue tap-rápido de toque-mantido (o cosmos usa isso: tap
      // curto = estrela; segurar = nebulosa).
      aoPingar(e.clientX, e.clientY, e.timeStamp - inicioTempo);
    } else if (arrastando) {
      // Fim de um arraste: avisa para a inércia assumir.
      aoSoltar();
    }
    ponteiroAtivo = null;
    if (!arrastando) movimentosPendentes.length = 0;
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
