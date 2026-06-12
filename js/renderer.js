// renderer.js — desenha o estado do motor num canvas 2D.
//
// Este módulo é o único que conhece o canvas. Ele recebe a geometria do
// motor (lista de polígonos coloridos) e a pinta da gota mais antiga para
// a mais nova — assim tinta recente cobre tinta antiga, como na superfície
// da água. Ele não decide QUANDO desenhar (isso é o loop do main, com a
// dirty flag) nem COMO a geometria muda (isso é o motor).

/** Teto de devicePixelRatio. Telas com DPR 3+ (celulares topo de linha)
 *  quadruplicariam ou mais o número de pixels rasterizados por quadro,
 *  sem ganho visual perceptível neste tipo de imagem. DPR 2 já é nítido. */
export const DPR_MAXIMO = 2;

/**
 * Cria um renderizador preso a um canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} corPapel - cor de fundo (o "papel" washi)
 */
export function criarRenderer(canvas, corPapel) {
  const ctx = canvas.getContext('2d');

  /**
   * Ajusta o tamanho interno do canvas ao tamanho CSS × DPR.
   *
   * Sem isso o canvas fica borrado em telas retina: o navegador esticaria
   * um bitmap pequeno para cobrir mais pixels físicos. A transform `scale`
   * deixa o resto do código trabalhar sempre em coordenadas CSS — o motor
   * nunca precisa saber que o DPR existe.
   */
  function redimensionar() {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAXIMO);
    const largura = canvas.clientWidth;
    const altura = canvas.clientHeight;
    canvas.width = Math.round(largura * dpr);
    canvas.height = Math.round(altura * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Desenha a obra inteira: papel + todas as gotas, na ordem de idade.
   *
   * @param {{ pontos: Float32Array, n: number, cor: string }[]} gotas
   */
  function desenhar(gotas) {
    ctx.fillStyle = corPapel;
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    // Cada gota é desenhada com curvas quadráticas em vez de segmentos
    // retos: o caminho passa pelos PONTOS MÉDIOS das arestas, usando cada
    // vértice como ponto de controle. É o truque clássico de suavização —
    // a curva resultante é contínua e sem quinas mesmo onde a reamostragem
    // ainda não refinou a borda, o que dá às gotas o aspecto líquido de
    // tinta sobre água em vez de polígono facetado. Custo: praticamente o
    // mesmo do lineTo.
    for (const gota of gotas) {
      const p = gota.pontos;
      const n = gota.n;
      ctx.fillStyle = gota.cor;
      ctx.beginPath();
      // Começa no ponto médio entre o último e o primeiro vértice.
      let px = (p[(n - 1) * 2] + p[0]) / 2;
      let py = (p[(n - 1) * 2 + 1] + p[1]) / 2;
      ctx.moveTo(px, py);
      for (let v = 0; v < n; v++) {
        const w = (v + 1) % n;
        const meioX = (p[v * 2] + p[w * 2]) / 2;
        const meioY = (p[v * 2 + 1] + p[w * 2 + 1]) / 2;
        ctx.quadraticCurveTo(p[v * 2], p[v * 2 + 1], meioX, meioY);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * Desenha um "véu" de papel translúcido por cima da imagem atual.
   * Usado pelo fade do botão lavar: a cada quadro o véu fica mais opaco,
   * como água limpa diluindo a tinta, até a obra desaparecer.
   *
   * @param {number} alfa - opacidade do véu, 0 (invisível) a 1 (papel limpo)
   */
  function desenharVeu(alfa) {
    ctx.save();
    ctx.globalAlpha = alfa;
    ctx.fillStyle = corPapel;
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.restore();
  }

  return { redimensionar, desenhar, desenharVeu };
}
