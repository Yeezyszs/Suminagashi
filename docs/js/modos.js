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
    // Poema BILÍNGUE para a galeria 3D: o quadro exibe o japonês (caligrafia
    // vertical) e a "janelinha" mostra a tradução PT — par a par, para que a
    // tradução seja FIEL ao que está escrito (não é o haiku PT acima). Três
    // versos (abertura · meio · fecho), escolhidos por semente da obra.
    poema: {
      abertura: [
        { ja: '水は静かに', pt: 'a água, quieta' },
        { ja: '墨ひとしずく', pt: 'uma gota de sumi' },
        { ja: '霧が流れて', pt: 'a névoa escorre' },
      ],
      meio: [
        { ja: '色が混ざり合う', pt: 'as cores se enlaçam' },
        { ja: '渦を描いて', pt: 'desenhando um redemoinho' },
        { ja: '紙にひろがる', pt: 'espalha-se no papel' },
      ],
      fecho: [
        { ja: '夜明けの前に', pt: 'antes do amanhecer' },
        { ja: '何も動かず', pt: 'nada se move' },
        { ja: 'ただ静けさ', pt: 'apenas o silêncio' },
      ],
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
    // Poema bilíngue (ver MODO_AGUA): o vazio e a luz, japonês + tradução.
    poema: {
      abertura: [
        { ja: '虚空が息づく', pt: 'o vazio respira' },
        { ja: '光のちりが', pt: 'poeira de luz' },
        { ja: '闇のふところ', pt: 'o seio da treva' },
      ],
      meio: [
        { ja: '星が生まれて', pt: 'nasce uma estrela' },
        { ja: '渦巻く銀河', pt: 'galáxia em espiral' },
        { ja: 'ひかりを集め', pt: 'reunindo a luz' },
      ],
      fecho: [
        { ja: '時の彼方で', pt: 'para além do tempo' },
        { ja: '果てしなく', pt: 'sem fim' },
        { ja: '夜のさなかに', pt: 'em pleno meio da noite' },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// MODO UKIYO-E — xilogravura (motor de LINHA em Canvas 2D, ver ukiyoe.js)
//
// O OPOSTO da água: controle, não acaso. Não é o fluido olhado no espelho —
// é OUTRO motor. Por isso traz `motor: 'ukiyoe'`: o main troca de motor (não
// só de render) ao entrar aqui. A cor selecionada pinta o PREENCHIMENTO; os
// "pincéis" trocam o gesto (contorno = linha sumi; espuma/chuva = padrões).
// ---------------------------------------------------------------------------

export const MODO_UKIYOE = {
  id: 'ukiyoe',
  nome: 'ukiyo-e',
  motor: 'ukiyoe',
  fundo: '#E7DDC4', // washi (o motor desenha o papel; esta é a cor base/atm)
  // Paleta histórica da xilogravura: poucas cores, harmônicas.
  paleta: [
    { nome: 'sumi', cor: '#1A1714' },
    { nome: 'azul de Prússia', cor: '#1B3B6F' },
    { nome: 'índigo', cor: '#27374D' },
    { nome: 'verde-acinzentado', cor: '#5E7261' },
    { nome: 'areia', cor: '#CBB994' },
    { nome: 'vermelho-tijolo', cor: '#A8432F' },
    { nome: 'branco-espuma', cor: '#F2EFE6' },
  ],
  // Os "pincéis" são os GESTOS do estilo. contorno = a linha de tinta; espuma
  // e chuva carimbam padrões estilizados (usam a cor selecionada).
  pinceis: [
    { id: 'contorno', nome: 'contorno', simbolo: '筆' },
    { id: 'espuma', nome: 'espuma', simbolo: '波' },
    { id: 'chuva', nome: 'chuva', simbolo: '雨' },
  ],
  densidade(rgb) {
    return rgb; // não usado (sem fluido); presente só p/ a casca comum
  },
  lexico: {
    frios: ['Onda', 'Maré', 'Espuma', 'Garoa', 'Bruma', 'Costa', 'Enseada'],
    quentes: ['Monte', 'Telhado', 'Lanterna', 'Ponte', 'Estrada', 'Festa'],
    neutros: ['Estampa', 'Gravura', 'Paisagem', 'Vista', 'Margem', 'Travessia'],
    raras: ['O Mundo Flutuante', 'Onde o Mar Toca o Céu', 'A Estampa Eterna'],
    haiku: {
      a: ['a grande onda', 'o monte ao longe', 'sobre o mar de Prússia', 'na estampa antiga'],
      b: ['uma garra {cor} se ergue', 'a linha {cor} fecha o céu', 'a {cor} chapa o mar', 'desce a chuva {cor}'],
      c: ['e o barco não volta', 'antes de quebrar', 'sob o papel velho', 'o mundo flutua'],
    },
    poema: {
      abertura: [
        { ja: '波の爪', pt: 'as garras da onda' },
        { ja: '浮世の絵', pt: 'imagem do mundo flutuante' },
        { ja: '藍の海', pt: 'o mar índigo' },
      ],
      meio: [
        { ja: '線が閉じる', pt: 'a linha se fecha' },
        { ja: '色を重ねて', pt: 'sobrepondo as cores' },
        { ja: '遠くの山', pt: 'a montanha ao longe' },
      ],
      fecho: [
        { ja: '古き紙に', pt: 'no papel antigo' },
        { ja: '世は移ろう', pt: 'o mundo passa' },
        { ja: '波が砕ける', pt: 'a onda se quebra' },
      ],
    },
  },
};

// COSMOS está ARQUIVADO do alternador (a régua agora é água ↔ ukiyo-e), mas
// fica aqui registrado — nada se perde; basta recolocá-lo no ciclo do toggle.
export const MODOS = { agua: MODO_AGUA, cosmos: MODO_COSMOS, ukiyoe: MODO_UKIYOE };
