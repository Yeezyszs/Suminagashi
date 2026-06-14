// modos.js — os modos de pintura como objetos de configuração.
//
// PRINCÍPIO (YAGNI): isto NÃO é um sistema de plugins. São só dois modos —
// água e cosmos — e este arquivo é o ÚNICO lugar onde eles diferem. O
// motor de fluido (advecção, vorticidade, pressão) não conhece "modo"
// nenhum: é o MESMO fluido nos dois. O que muda é só como a densidade do
// fluido é LIDA — água absorve luz (tinta sobre papel), cosmos emite luz
// (gás sobre o vazio). É o mesmo fluido, olhado no espelho.
//
// Cada modo descreve cinco eixos de diferença:
//   1. render   — como a densidade vira pixel (subtrativo vs. aditivo)
//   2. fundo    — a cor base atrás do fluido (washi vs. vazio)
//   3. paleta   — as tintas disponíveis (pigmentos vs. cores estelares)
//   4. especiais— gestos exclusivos do modo (cosmos: estrelas)
//   5. lexico   — vocabulário do batismo (nomes/haiku)
// e uma função `densidade(rgb)`: como uma cor escolhida vira densidade de
// fluido (a conversão é a face matemática do "espelho").

// ---------------------------------------------------------------------------
// Conversões de cor compartilhadas
// ---------------------------------------------------------------------------

/** '#RRGGBB' → [r, g, b] em [0, 1]. */
export function hexParaRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

// ---------------------------------------------------------------------------
// MODO ÁGUA — tinta sobre papel (subtrativo, Beer-Lambert)
// ---------------------------------------------------------------------------

const EPS = 1e-3;

export const MODO_AGUA = {
  id: 'agua',
  nome: 'água',
  render: 0, // 0 = subtrativo no shader de composição
  fundo: '#EFE9DC', // washi
  // 10 tintas; o pincel especial (água) dilui a densidade.
  paleta: [
    { nome: 'sumi', cor: '#1C1C1C' },
    { nome: 'índigo', cor: '#1F3A5F' },
    { nome: 'vermelhão', cor: '#C8401F' },
    { nome: 'verde-pinho', cor: '#3E5C43' },
    { nome: 'amarelo-ouro', cor: '#D4A937' },
    { nome: 'azul-céu', cor: '#7BA7C7' },
    { nome: 'rosa', cor: '#D08CA0' },
    { nome: 'verde-claro', cor: '#9CB97E' },
    { nome: 'ameixa', cor: '#7A5577' },
    { nome: 'terracota', cor: '#C07A50' },
  ],
  // Pincéis especiais (além das cores): a água dilui pigmento (abre anéis).
  pinceis: [{ id: 'agua', nome: 'água', simbolo: '○' }],

  /**
   * Cor → densidade óptica (Beer-Lambert invertido): para uma camada da
   * tinta pura mostrar a cor C sobre papel branco, a densidade é −ln(C)
   * (pois papel·exp(−(−ln C)) = papel·C). O ε protege canais zerados.
   */
  densidade(rgb) {
    return [
      -Math.log(Math.max(rgb[0], EPS)),
      -Math.log(Math.max(rgb[1], EPS)),
      -Math.log(Math.max(rgb[2], EPS)),
    ];
  },

  lexico: {
    frios: ['Maré', 'Névoa', 'Luar', 'Vazante', 'Remanso', 'Bruma', 'Sereno', 'Orvalho'],
    quentes: ['Âmbar', 'Brasa', 'Crepúsculo', 'Ocaso', 'Lume', 'Reflexo', 'Aurora'],
    neutros: ['Corrente', 'Onda', 'Espelho', 'Murmúrio', 'Deriva', 'Sombra'],
    raras: ['Onde a Água Dorme', 'O Rio que Não Volta', 'Espelho de Tinta'],
    haiku: {
      a: ['água parada', 'a tinta repousa', 'névoa na bacia', 'sobre o washi'],
      b: ['um fio {cor} se abre', 'a {cor} encontra a corrente', 'desliza o {cor} sem pressa', '{cor} dobra na água'],
      c: ['e a {periodo} se cala', 'antes que a luz volte', 'a bacia respira', 'nada mais se move'],
    },
  },
};

// ---------------------------------------------------------------------------
// MODO COSMOS — gás luminoso sobre o vazio (aditivo, emissivo)
// ---------------------------------------------------------------------------

/** Quanto de densidade uma cor estelar injeta. A densidade aqui não é
 *  absorção (como na água) e sim LUZ emitida: o render soma fundo +
 *  (1 − exp(−densidade)), um tonemap suave que satura sem estourar. */
const GANHO_EMISSIVO = 1.6;

export const MODO_COSMOS = {
  id: 'cosmos',
  nome: 'cosmos',
  render: 1, // 1 = aditivo/emissivo no shader
  fundo: '#05060D', // vazio profundo (nunca #000 chapado)
  // Cores estelares emissivas (brilham sobre o escuro).
  paleta: [
    { nome: 'branco-azulado', cor: '#CDD8FF' },
    { nome: 'ciano', cor: '#7FE7FF' },
    { nome: 'azul-estelar', cor: '#5A78FF' },
    { nome: 'violeta', cor: '#9B6BFF' },
    { nome: 'magenta', cor: '#FF6AD5' },
    { nome: 'rosa-poeira', cor: '#FFB3C8' },
    { nome: 'âmbar-estelar', cor: '#FFCF8A' },
    { nome: 'ouro-pálido', cor: '#FFE9A8' },
    { nome: 'verde-nebulosa', cor: '#8AFFC1' },
  ],
  // Pincéis especiais. As ESTRELAS não são um pincel: elas florescem onde a
  // poeira (as cores) se acumula além de um limiar. Aqui ficam só:
  //   'sopro' — espalha/esfumaça a luz já pintada (véus, caudas);
  //   'vazio' — apaga luz (esculpe espaço negativo).
  pinceis: [
    { id: 'sopro', nome: 'sopro', simbolo: '∿' },
    { id: 'vazio', nome: 'vazio', simbolo: '○' },
  ],

  /** Cor estelar → densidade emissiva: linear na cor (a luz que ela
   *  irradia), escalada pelo ganho. Somar densidades = somar luz. */
  densidade(rgb) {
    return [rgb[0] * GANHO_EMISSIVO, rgb[1] * GANHO_EMISSIVO, rgb[2] * GANHO_EMISSIVO];
  },

  lexico: {
    frios: ['Nebulosa', 'Aurora', 'Halo', 'Cintilação', 'Véu', 'Constelação', 'Cometa'],
    quentes: ['Supernova', 'Fulgor', 'Coroa', 'Pulsar', 'Brasa Estelar', 'Forja'],
    neutros: ['Cosmos', 'Galáxia', 'Poeira', 'Órbita', 'Abismo', 'Silêncio Sideral'],
    raras: ['Onde Nascem as Estrelas', 'O Sopro do Vazio', 'Antes da Primeira Luz'],
    haiku: {
      a: ['o vazio respira', 'silêncio sem fundo', 'a noite sem chão', 'poeira de luz'],
      b: ['nasce um fio {cor}', 'a {cor} se acende devagar', 'gira o gás {cor}', 'uma nuvem {cor} se abre'],
      c: ['na {periodo} sem fim', 'e uma estrela acende', 'longe de toda manhã', 'antes do tempo existir'],
    },
  },
};

export const MODOS = { agua: MODO_AGUA, cosmos: MODO_COSMOS };
