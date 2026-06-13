// ritual.js — extração do tema e do temperamento da primeira pintura.
//
// O ritual de entrada lê a obra (pixels) e o jeito de pintar (telemetria
// de gestos) e os reduz a poucos tokens: duas cores de tema e um escalar
// "calma". Tudo aqui é FUNÇÃO PURA — entra dado, sai dado, nada de DOM —
// para que a calibração futura (e eventuais testes) sejam triviais.

// ---------------------------------------------------------------------------
// Conversões de cor
// ---------------------------------------------------------------------------

/** RGB [0..1] → HSL ([0..360), [0..1], [0..1]). */
export function rgbParaHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l]; // acromático

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

/** HSL → RGB [0..1]. */
export function hslParaRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t) => {
    t = ((t % 360) + 360) % 360;
    if (t < 60) return p + (q - p) * (t / 60);
    if (t < 180) return q;
    if (t < 240) return p + (q - p) * ((240 - t) / 60);
    return p;
  };
  return [canal(h + 120), canal(h), canal(h - 120)];
}

/** RGB [0..1] → '#rrggbb'. */
export function rgbParaHex([r, g, b]) {
  const c = (v) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Luminância relativa (WCAG): quão "clara" uma cor parece ao olho. */
export function luminancia([r, g, b]) {
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Razão de contraste WCAG entre duas cores (1..21). */
export function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------------------
// Extração do tema
// ---------------------------------------------------------------------------

/** Contraste mínimo aceitável para texto da UI (WCAG AA). */
export const CONTRASTE_MINIMO = 4.5;

/** Quanto da saturação da dominante sobrevive no fundo (15% = dessaturada
 *  em ~85%, como o brief pede: um neutro confortável da mesma família). */
const SATURACAO_FUNDO = 0.15;

/** Claridade-alvo do fundo (tema claro, como o washi original). */
const CLARIDADE_FUNDO = 0.91;

/** Quanto o papel da simulação é puxado na direção do fundo do tema. */
const TINGIMENTO_PAPEL = 0.35;

/** Fração mínima de "tinta visível" para a obra render um tema. Abaixo
 *  disso a pintura foi tímida demais — não force um tema a partir de
 *  meia dúzia de pixels (caso de borda do brief). */
const PESO_MINIMO = 0.01;

/**
 * Lê os pixels da obra e deriva o tema do site.
 *
 * Como funciona: cada pixel ganha um PESO = distância da cor do papel
 * (pixel idêntico ao papel não diz nada sobre a obra). Pixels coloridos
 * são acumulados em 12 baldes de matiz (30° cada); cinzas/quase-pretos
 * (saturação ínfima) caem num balde próprio. Os dois baldes mais pesados
 * viram as cores do tema:
 *
 *   - acento: a média ponderada do balde nº 1, com a claridade ajustada
 *     até ter contraste WCAG AA sobre o fundo (é a cor de texto da UI);
 *   - fundo: a família do balde nº 2 (ou do nº 1, se só houver um),
 *     dessaturada e clareada para um neutro confortável.
 *
 * @param {Uint8Array} pixels - RGBA (como sai do readPixels)
 * @param {number} w
 * @param {number} h
 * @param {[number,number,number]} papel - cor do papel em [0..1]
 * @returns {{ acento: string, fundo: string, papel: string } | null}
 *   null = obra vazia demais para ter tema
 */
export function extrairTema(pixels, w, h, papel) {
  const NUM_BALDES = 13; // 12 matizes + 1 para acromáticos
  const peso = new Float64Array(NUM_BALDES);
  const somaR = new Float64Array(NUM_BALDES);
  const somaG = new Float64Array(NUM_BALDES);
  const somaB = new Float64Array(NUM_BALDES);
  let pesoTotal = 0;

  for (let i = 0; i < w * h; i++) {
    const r = pixels[i * 4] / 255;
    const g = pixels[i * 4 + 1] / 255;
    const b = pixels[i * 4 + 2] / 255;

    // Peso: o quanto este pixel difere do papel (0 = papel puro).
    const p = Math.max(
      Math.abs(r - papel[0]),
      Math.abs(g - papel[1]),
      Math.abs(b - papel[2])
    );
    if (p < 0.08) continue; // ~papel: ignora

    const [hMatiz, s] = rgbParaHsl(r, g, b);
    const balde = s < 0.12 ? 12 : Math.floor(hMatiz / 30) % 12;
    peso[balde] += p;
    somaR[balde] += r * p;
    somaG[balde] += g * p;
    somaB[balde] += b * p;
    pesoTotal += p;
  }

  // Obra tímida demais? Sem tema (o site permanece neutro).
  if (pesoTotal < w * h * PESO_MINIMO) return null;

  // Os dois baldes mais pesados, em ordem.
  const indices = [...peso.keys()].sort((a, b2) => peso[b2] - peso[a]);
  const balde1 = indices[0];
  const balde2 = peso[indices[1]] > 0 ? indices[1] : balde1;

  const mediaDoBalde = (i) => [
    somaR[i] / peso[i],
    somaG[i] / peso[i],
    somaB[i] / peso[i],
  ];

  // --- fundo: família da 2ª dominante, dessaturada e clareada -------------
  const [h2, s2] = rgbParaHsl(...mediaDoBalde(balde2));
  const fundo = hslParaRgb(h2, s2 * SATURACAO_FUNDO, CLARIDADE_FUNDO);

  // --- acento: 1ª dominante, escurecida até contrastar com o fundo --------
  // (a UI usa o acento como cor de texto: AA é o piso de legibilidade)
  const [h1, s1, l1] = rgbParaHsl(...mediaDoBalde(balde1));
  let acento = hslParaRgb(h1, s1, l1);
  let claridade = l1;
  while (contraste(acento, fundo) < CONTRASTE_MINIMO && claridade > 0.05) {
    claridade -= 0.04;
    acento = hslParaRgb(h1, s1, claridade);
  }

  // --- papel da simulação: leve tint da família do fundo ------------------
  const papelTingido = [
    papel[0] + (fundo[0] - papel[0]) * TINGIMENTO_PAPEL,
    papel[1] + (fundo[1] - papel[1]) * TINGIMENTO_PAPEL,
    papel[2] + (fundo[2] - papel[2]) * TINGIMENTO_PAPEL,
  ];

  return {
    acento: rgbParaHex(acento),
    fundo: rgbParaHex(fundo),
    papel: rgbParaHex(papelTingido),
  };
}

// ---------------------------------------------------------------------------
// Temperamento do gesto
// ---------------------------------------------------------------------------

/**
 * Reduz a telemetria do ritual a um escalar calma ∈ [0, 1]
 * (1 = gesto lento e espaçado; 0 = frenético).
 *
 * Três sinais, cada um normalizado para o seu lado "calmo":
 *   - cadência: poucos gestos por minuto = calmo (8/min já é contemplativo;
 *     40/min é alguém metralhando a tela);
 *   - velocidade média de arraste: estilete lento = calmo;
 *   - proporção de taps: pingar e observar é mais calmo que arrastar sem
 *     parar.
 *
 * Os pesos (0.4 / 0.4 / 0.2) são um chute inicial honesto — esta função
 * existe isolada exatamente para ser calibrada depois com obras reais.
 *
 * @param {{ gestosPorMinuto: number, velocidadeMedia: number,
 *           proporcaoTap: number }} t
 * @returns {number} calma em [0, 1]
 */
export function calcularCalma(t) {
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const calmaCadencia = clamp01((40 - t.gestosPorMinuto) / (40 - 8));
  const calmaVelocidade = clamp01((1200 - t.velocidadeMedia) / (1200 - 150));
  const calmaTap = clamp01(t.proporcaoTap);
  return clamp01(0.4 * calmaCadencia + 0.4 * calmaVelocidade + 0.2 * calmaTap);
}

/**
 * Mapeia a calma para os parâmetros que ela controla.
 *
 * @param {number} calma - [0, 1]
 * @returns {{ ritmoOndulacao: number, duracaoTransicaoMs: number }}
 *   ritmoOndulacao multiplica o relógio da respiração da água (calmo →
 *   mais lenta); duracaoTransicaoMs é a duração das transições da UI
 *   (calmo → mais longas, mais cerimoniosas).
 */
export function mapearCalma(calma) {
  return {
    ritmoOndulacao: 1.5 - 0.9 * calma, // agitado 1.5 ... calmo 0.6
    duracaoTransicaoMs: Math.round(500 + 700 * calma),
  };
}
