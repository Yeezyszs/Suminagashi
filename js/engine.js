// engine.js — motor de marbling (suminagashi), técnica de Aubrey Jaffer.
//
// REGRA ARQUITETURAL: este módulo é matemática pura. Nenhuma referência a
// window, document ou canvas pode existir aqui. O motor recebe comandos
// (pingar gota, arrastar estilete) e mantém apenas geometria: uma lista de
// polígonos coloridos. Quem desenha é o renderer; quem captura gestos é o
// input. Motivo: modos futuros (replay determinístico por seed, export em
// alta resolução) vão reusar este motor fora do fluxo interativo — um deles
// rodando "às cegas" a partir de um log de comandos, outro re-renderizando
// a mesma geometria num canvas 8K. Isso só é barato se o motor não souber
// que canvas existe.
//
// A ideia central da técnica de Jaffer: em vez de simular fluido (caro e
// imprevisível), cada gota de tinta é um POLÍGONO FECHADO, e cada operação
// física (pingar, arrastar) vira uma FUNÇÃO MATEMÁTICA FECHADA aplicada a
// todos os vértices de todos os polígonos. O resultado é determinístico,
// rápido e visualmente idêntico ao marbling real.

// ---------------------------------------------------------------------------
// Constantes do motor (valores em coordenadas CSS, i.e. pixels lógicos)
// ---------------------------------------------------------------------------

/** Quantos vértices tem o círculo inicial de uma gota recém-pingada.
 *  120 é suficiente para a borda parecer lisa mesmo após deformações leves. */
export const VERTICES_INICIAIS = 120;

/** Teto de gotas simultâneas. Ao exceder, a mais antiga é removida —
 *  como tinta velha que se dissolve na água. Mantém o custo por operação
 *  limitado (custo total ∝ gotas × vértices). */
export const MAX_GOTAS = 80;

/** Teto de vértices por gota. Deformações esticam o perímetro e a
 *  reamostragem insere pontos; sem um teto, gotas muito trabalhadas
 *  explodiriam em custo. Ao atingir o teto, paramos de subdividir
 *  (aceitando leve facetamento) — NUNCA removemos vértices, pois isso
 *  rasgaria visualmente o polígono. */
export const MAX_VERTICES = 600;

/** Comprimento máximo de aresta antes de subdividir (px). Arestas mais
 *  longas que isso ficam visivelmente facetadas quando a curva é fechada. */
export const LIMIAR_SUBDIVISAO = 5;

/** Raio de influência do estilete (px). Na fórmula (λ/(λ+d))², o λ marca
 *  a distância em que o efeito cai para 1/4 da força máxima: perto do
 *  dedo a tinta acompanha o gesto, longe quase não se move. */
export const LAMBDA_ESTILETE = 60;

/** Proteção numérica: distância mínima considerada nos deslocamentos.
 *  Sem isso, um vértice exatamente no centro de uma gota nova (caso real:
 *  pingar duas vezes no mesmo ponto, como no teste dos anéis concêntricos)
 *  causaria divisão por zero. */
const EPSILON = 1e-6;

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

/**
 * Cria um motor de suminagashi vazio.
 *
 * O estado é uma lista ordenada de gotas — pintadas da mais antiga para a
 * mais nova, de modo que tinta recente cobre tinta antiga, como na água.
 * Cada gota é { pontos: Float32Array de pares [x0,y0,x1,y1,...], n: número
 * de vértices em uso, cor: string }.
 *
 * O Float32Array é alocado já no tamanho máximo (MAX_VERTICES) e o campo
 * `n` diz quantos vértices estão em uso. Assim a reamostragem cresce a gota
 * sem realocar memória a cada operação — importante para manter 60fps
 * durante o arraste contínuo, quando o GC não pode ser acionado.
 */
export function criarMotor() {
  /** @type {{ pontos: Float32Array, n: number, cor: string }[]} */
  const gotas = [];

  // Buffer de trabalho reutilizado pela reamostragem (evita alocar a cada
  // operação). Tamanho: o pior caso é dobrar os vértices de uma gota cheia.
  const bufferReamostragem = new Float32Array(MAX_VERTICES * 2 * 2);

  // -------------------------------------------------------------------------
  // 1. Pingar gota — deslocamento por inserção
  // -------------------------------------------------------------------------

  /**
   * Pinga uma gota nova de centro (cx, cy), raio r e cor dada.
   *
   * A física real: uma gota nova ocupa área na superfície da água e empurra
   * toda a tinta existente para fora. A fórmula fechada de Jaffer:
   *
   *     P' = C + (P − C) · sqrt(1 + r² / |P − C|²)
   *
   * Por que essa fórmula e não outra? Porque ela PRESERVA ÁREA: um ponto a
   * distância d do centro vai parar a distância sqrt(d² + r²), ou seja, o
   * anel de área π·d² vira o anel de área π·(d² + r²) — exatamente a área
   * antiga mais a área π·r² da gota nova. A tinta é "incompressível", como
   * na água de verdade. Perto do centro o empurrão é forte; longe, tende a
   * zero (sqrt(1 + r²/d²) → 1 quando d cresce). É isso que dá o visual de
   * tinta deslocando tinta, e é por isso que pingar "água" (gota da cor do
   * papel) cria os anéis do suminagashi clássico: ela empurra sem cobrir.
   */
  function pingar(cx, cy, r, cor) {
    const r2 = r * r;

    // Empurra todos os vértices de todas as gotas existentes.
    for (const gota of gotas) {
      const p = gota.pontos;
      const fim = gota.n * 2;
      for (let i = 0; i < fim; i += 2) {
        const dx = p[i] - cx;
        const dy = p[i + 1] - cy;
        // max com EPSILON: protege o caso do vértice cair exatamente no
        // centro da gota nova (divisão por zero).
        const d2 = Math.max(dx * dx + dy * dy, EPSILON);
        const fator = Math.sqrt(1 + r2 / d2);
        p[i] = cx + dx * fator;
        p[i + 1] = cy + dy * fator;
      }
    }

    // Insere a gota nova como um círculo discretizado.
    const pontos = new Float32Array(MAX_VERTICES * 2);
    for (let v = 0; v < VERTICES_INICIAIS; v++) {
      const ang = (v / VERTICES_INICIAIS) * Math.PI * 2;
      pontos[v * 2] = cx + Math.cos(ang) * r;
      pontos[v * 2 + 1] = cy + Math.sin(ang) * r;
    }
    gotas.push({ pontos, n: VERTICES_INICIAIS, cor });

    // Excedeu o teto? Remove a mais antiga (índice 0 — a primeira pintada).
    if (gotas.length > MAX_GOTAS) gotas.shift();

    // O deslocamento estica as arestas das gotas vizinhas.
    reamostrarTudo();
  }

  // -------------------------------------------------------------------------
  // 2. Estilete — arrastar a tinta
  // -------------------------------------------------------------------------

  /**
   * Aplica um segmento de movimento do estilete.
   *
   * F = (fx, fy) é a posição atual do dedo/cursor, M = (mx, my) é a direção
   * UNITÁRIA do movimento e z é a intensidade (proporcional à velocidade do
   * gesto, com teto — quem calcula isso é o input). Cada vértice P se move
   * na direção do gesto, com força decaindo com a distância d até o dedo:
   *
   *     P' = P + M · z · (λ / (λ + d))²
   *
   * O decaimento (λ/(λ+d))² vale 1 quando d=0 (a tinta sob o dedo acompanha
   * o gesto por inteiro) e cai suavemente: 1/4 em d=λ, ~1/9 em d=2λ. O
   * expoente 2 faz a influência morrer rápido o bastante para o efeito
   * parecer um estilete fino puxando a tinta, e não uma correnteza global.
   * Diferente do pingar, esta fórmula NÃO preserva área — fisicamente o
   * estilete cisalha a superfície — mas a distorção é pequena e o olho não
   * percebe.
   */
  function estilete(fx, fy, mx, my, z) {
    for (const gota of gotas) {
      const p = gota.pontos;
      const fim = gota.n * 2;
      for (let i = 0; i < fim; i += 2) {
        const dx = p[i] - fx;
        const dy = p[i + 1] - fy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const queda = LAMBDA_ESTILETE / (LAMBDA_ESTILETE + d);
        const forca = z * queda * queda;
        p[i] += mx * forca;
        p[i + 1] += my * forca;
      }
    }
    reamostrarTudo();
  }

  // -------------------------------------------------------------------------
  // 3. Reamostragem — manter as bordas lisas
  // -------------------------------------------------------------------------

  /**
   * Subdivide arestas esticadas de todas as gotas.
   *
   * Por que isso é necessário: as deformações movem VÉRTICES, mas quem
   * desenhamos são as ARESTAS retas entre eles. Quando uma região é muito
   * esticada (ex.: a borda de uma gota empurrada por outra), os vértices
   * se afastam e a curva — que deveria ser lisa — vira uma linha facetada,
   * denunciando o polígono por baixo da "tinta". A correção: toda aresta
   * mais longa que LIMIAR_SUBDIVISAO ganha um ponto médio, que nas próximas
   * deformações se moverá de forma independente e recuperará a curvatura.
   *
   * O teto MAX_VERTICES limita o custo: gotas no teto simplesmente param
   * de ganhar pontos (leve facetamento é melhor que travar o quadro).
   */
  function reamostrarTudo() {
    const limiar2 = LIMIAR_SUBDIVISAO * LIMIAR_SUBDIVISAO;

    for (const gota of gotas) {
      if (gota.n >= MAX_VERTICES) continue;

      const p = gota.pontos;
      const n = gota.n;
      const buf = bufferReamostragem;
      let m = 0; // vértices escritos no buffer

      for (let v = 0; v < n; v++) {
        const ax = p[v * 2];
        const ay = p[v * 2 + 1];
        // O polígono é fechado: o vizinho do último vértice é o primeiro.
        const w = (v + 1) % n;
        const bx = p[w * 2];
        const by = p[w * 2 + 1];

        // Copia o vértice atual...
        buf[m * 2] = ax;
        buf[m * 2 + 1] = ay;
        m++;

        // ...e insere o ponto médio se a aresta passou do limiar.
        // Comparamos distâncias ao quadrado para evitar sqrt no loop quente.
        const dx = bx - ax;
        const dy = by - ay;
        if (dx * dx + dy * dy > limiar2 && m + (n - v) < MAX_VERTICES) {
          buf[m * 2] = ax + dx * 0.5;
          buf[m * 2 + 1] = ay + dy * 0.5;
          m++;
        }
      }

      if (m > n) {
        gota.pontos.set(buf.subarray(0, m * 2));
        gota.n = m;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Utilitários
  // -------------------------------------------------------------------------

  /** Remove todas as gotas (o fade visual do "lavar" é papel do renderer). */
  function limpar() {
    gotas.length = 0;
  }

  return { gotas, pingar, estilete, limpar };
}
