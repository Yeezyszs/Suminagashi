// haiku.js — coleção curada de haikus clássicos + a seleção que "lê" a obra e
// escolhe o poema de melhor clima. O haiku escolhido é mostrado ao aproximar
// da obra na galeria 3D (japonês em colunas + tradução + autor).
//
// POR QUE UM MÓDULO JS (e não um .json carregado por fetch): o projeto abre
// offline e até por file://, onde fetch() de um arquivo local falha. Como ES
// module, os dados entram sem rede nenhuma — fiel ao "nada baixado em runtime".
//
// ⚠️ TEXTO EXIBIDO: o campo `jp` (e `jpLinhas`, os 3 versos 5-7-5) é mostrado
// ao usuário, então a ortografia foi CONFERIDA contra fontes confiáveis
// (Wikipédia japonesa, páginas acadêmicas/educacionais) em 16/06/2026. Todos
// os `jp` são formas canônicas atestadas. Domínio público (mestres Edo/Meiji,
// +1 século de falecidos). Expandir a coleção para ~30-50 itens melhora o encaixe.

import { mulberry32 } from './prng.js';

/**
 * @typedef {object} Haiku
 * @property {string} id
 * @property {string} autor
 * @property {string} jp     - texto japonês (o que se traça)
 * @property {string} romaji - leitura, versos separados por ' / '
 * @property {string} pt     - tradução livre
 * @property {{estacao:string, imagem:string[], energia:string, temperatura:string}} tags
 */

/** Coleção curada (verificada). Tags: estacao primavera|verao|outono|inverno;
 *  energia sereno|vivo|agitado; temperatura frio|neutro|quente; imagem é uma
 *  lista de motivos (agua, lua, neve, flor, animal, montanha, vento, campo,
 *  templo). */
export const HAIKUS = [
  {
    id: 'basho-furuike',
    autor: 'Matsuo Bashō',
    jp: '古池や蛙飛び込む水の音',
    jpLinhas: ['古池や', '蛙飛び込む', '水の音'],
    romaji: 'furuike ya / kawazu tobikomu / mizu no oto',
    pt: 'o velho tanque — / uma rã mergulha: / o som da água',
    tags: { estacao: 'primavera', imagem: ['agua', 'animal'], energia: 'sereno', temperatura: 'frio' },
  },
  {
    id: 'basho-natsukusa',
    autor: 'Matsuo Bashō',
    jp: '夏草や兵どもが夢の跡',
    jpLinhas: ['夏草や', '兵どもが', '夢の跡'],
    romaji: 'natsukusa ya / tsuwamonodomo ga / yume no ato',
    pt: 'ervas de verão — / tudo o que restou / dos sonhos dos guerreiros',
    tags: { estacao: 'verao', imagem: ['campo'], energia: 'sereno', temperatura: 'neutro' },
  },
  {
    // jp 閑さや lê-se "shizukasa" (não "shizukesa"): romaji corrigido na
    // validação contra a Wikipédia japonesa.
    id: 'basho-shizukasa',
    autor: 'Matsuo Bashō',
    jp: '閑さや岩にしみ入る蝉の声',
    jpLinhas: ['閑さや', '岩にしみ入る', '蝉の声'],
    romaji: 'shizukasa ya / iwa ni shimiiru / semi no koe',
    pt: 'que quietude — / penetra na rocha / o canto das cigarras',
    tags: { estacao: 'verao', imagem: ['animal', 'montanha'], energia: 'sereno', temperatura: 'quente' },
  },
  {
    id: 'basho-tabi-ni-yande',
    autor: 'Matsuo Bashō',
    jp: '旅に病んで夢は枯野をかけ廻る',
    jpLinhas: ['旅に病んで', '夢は枯野を', 'かけ廻る'],
    romaji: 'tabi ni yande / yume wa kareno wo / kakemeguru',
    pt: 'doente em viagem — / meus sonhos vagueiam / por campos secos',
    tags: { estacao: 'inverno', imagem: ['campo'], energia: 'sereno', temperatura: 'frio' },
  },
  {
    id: 'buson-haru-no-umi',
    autor: 'Yosa Buson',
    jp: '春の海終日のたりのたりかな',
    jpLinhas: ['春の海', '終日のたり', 'のたりかな'],
    romaji: 'haru no umi / hinemosu notari / notari kana',
    pt: 'mar de primavera — / o dia inteiro subindo / e descendo, sereno',
    tags: { estacao: 'primavera', imagem: ['agua'], energia: 'sereno', temperatura: 'neutro' },
  },
  {
    id: 'buson-na-no-hana',
    autor: 'Yosa Buson',
    jp: '菜の花や月は東に日は西に',
    jpLinhas: ['菜の花や', '月は東に', '日は西に'],
    romaji: 'na no hana ya / tsuki wa higashi ni / hi wa nishi ni',
    pt: 'campos de colza — / a lua a leste, / o sol a oeste',
    tags: { estacao: 'primavera', imagem: ['flor', 'lua'], energia: 'sereno', temperatura: 'quente' },
  },
  {
    id: 'buson-samidare',
    autor: 'Yosa Buson',
    jp: '五月雨や大河を前に家二軒',
    jpLinhas: ['五月雨や', '大河を前に', '家二軒'],
    romaji: 'samidare ya / taiga wo mae ni / ie niken',
    pt: 'chuvas de verão — / diante do grande rio, / duas casinhas',
    tags: { estacao: 'verao', imagem: ['agua'], energia: 'agitado', temperatura: 'frio' },
  },
  {
    id: 'issa-suzume-no-ko',
    autor: 'Kobayashi Issa',
    jp: '雀の子そこのけそこのけお馬が通る',
    jpLinhas: ['雀の子', 'そこのけそこのけ', 'お馬が通る'],
    romaji: 'suzume no ko / sokonoke sokonoke / o-uma ga tooru',
    pt: 'filhote de pardal, / sai da frente, sai da frente — / lá vem o cavalo',
    tags: { estacao: 'primavera', imagem: ['animal'], energia: 'vivo', temperatura: 'quente' },
  },
  {
    id: 'issa-meigetsu',
    autor: 'Kobayashi Issa',
    jp: '名月を取ってくれろと泣く子かな',
    jpLinhas: ['名月を', '取ってくれろと', '泣く子かな'],
    romaji: 'meigetsu wo / totte kurero to / naku ko kana',
    pt: '"me dá a lua cheia!" — / chora a criança / apontando pro céu',
    tags: { estacao: 'outono', imagem: ['lua'], energia: 'vivo', temperatura: 'neutro' },
  },
  {
    id: 'issa-yasegaeru',
    autor: 'Kobayashi Issa',
    jp: '痩蛙まけるな一茶これにあり',
    jpLinhas: ['痩蛙', 'まけるな一茶', 'これにあり'],
    romaji: 'yasegaeru / makeru na Issa / kore ni ari',
    pt: 'rã magrela, / não desista — / o Issa está aqui',
    tags: { estacao: 'primavera', imagem: ['animal'], energia: 'vivo', temperatura: 'neutro' },
  },
  {
    id: 'chiyo-asagao',
    autor: 'Fukuda Chiyo-ni',
    jp: '朝顔に釣瓶とられてもらひ水',
    jpLinhas: ['朝顔に', '釣瓶とられて', 'もらひ水'],
    romaji: 'asagao ni / tsurube torarete / morai mizu',
    pt: 'a corriola tomou / o balde do poço — / vou pedir água emprestada',
    tags: { estacao: 'outono', imagem: ['flor', 'agua'], energia: 'sereno', temperatura: 'frio' },
  },
  {
    id: 'shiki-kaki',
    autor: 'Masaoka Shiki',
    jp: '柿くへば鐘が鳴るなり法隆寺',
    jpLinhas: ['柿くへば', '鐘が鳴るなり', '法隆寺'],
    romaji: 'kaki kueba / kane ga naru nari / Hōryūji',
    pt: 'mordo um caqui — / e o sino ressoa: / templo de Hōryū',
    tags: { estacao: 'outono', imagem: ['templo', 'flor'], energia: 'sereno', temperatura: 'quente' },
  },
  {
    id: 'shiki-yuki',
    autor: 'Masaoka Shiki',
    jp: 'いくたびも雪の深さを尋ねけり',
    jpLinhas: ['いくたびも', '雪の深さを', '尋ねけり'],
    romaji: 'ikutabi mo / yuki no fukasa wo / tazune keri',
    pt: 'tantas e tantas vezes / perguntei o quanto / a neve já fundou',
    tags: { estacao: 'inverno', imagem: ['neve'], energia: 'sereno', temperatura: 'frio' },
  },
  {
    id: 'basho-kareeda',
    autor: 'Matsuo Bashō',
    jp: '枯枝に烏のとまりけり秋の暮',
    jpLinhas: ['枯枝に', '烏のとまりけり', '秋の暮'],
    romaji: 'kareeda ni / karasu no tomari keri / aki no kure',
    pt: 'num galho seco / um corvo pousou — / entardecer de outono',
    tags: { estacao: 'outono', imagem: ['animal', 'campo'], energia: 'sereno', temperatura: 'neutro' },
  },
];

// ---------------------------------------------------------------------------
// Seleção: o site "lê" a obra e escolhe o haiku de melhor clima.
// ---------------------------------------------------------------------------

// Pesos do encaixe (calibração). Estação e energia mandam mais; temperatura
// ajusta; a imagem só desempata quando há um sinal claro (ex.: lua no cosmos).
const PESO_ESTACAO = 3;
const PESO_ENERGIA = 3;
const PESO_TEMPERATURA = 2;
const PESO_IMAGEM = 1;

// Hemisfério do usuário para o mapa mês→estação. O projeto nasce no Brasil
// (Sul): junho = inverno. Trocar para 'norte' inverte. (Constante de tato.)
const HEMISFERIO = 'sul';

/** Estação do ano a partir do mês (0–11), no hemisfério configurado. */
export function estacaoDoMes(date, hemisferio = HEMISFERIO) {
  const m = date.getMonth(); // 0=jan
  // Estações no hemisfério NORTE por mês.
  const norte = ['inverno', 'inverno', 'primavera', 'primavera', 'primavera', 'verao',
    'verao', 'verao', 'outono', 'outono', 'outono', 'inverno'][m];
  if (hemisferio === 'norte') return norte;
  // No Sul, a estação é a oposta.
  const oposta = { primavera: 'outono', outono: 'primavera', verao: 'inverno', inverno: 'verao' };
  return oposta[norte];
}

/** Temperatura (frio/neutro/quente) a partir da calidez [-1,1] do retrato. */
export function temperaturaDaCalidez(calidez) {
  return calidez > 0.15 ? 'quente' : calidez < -0.15 ? 'frio' : 'neutro';
}

/**
 * Escolhe o haiku que melhor combina com a obra (função PURA). Pontua cada
 * candidato por concordância de tags com o "retrato" da obra + a estação do
 * dia; o de maior pontuação vence. Empates são resolvidos de forma
 * DETERMINÍSTICA pela semente da obra — a mesma obra escolhe sempre o mesmo
 * haiku. Sempre devolve um (se nada casa, o de maior pontuação ainda assim).
 *
 * @param {{temperatura?:string, energia?:string, imagem?:string[]}} retrato
 * @param {Date} date
 * @param {number} semente - hash da obra (determinismo no desempate)
 * @param {Haiku[]} colecao
 * @returns {Haiku}
 */
export function selecionarHaiku(retrato, date, semente, colecao = HAIKUS) {
  const estacao = estacaoDoMes(date);
  const imagens = retrato.imagem || [];

  let melhorPontos = -1;
  let candidatos = [];
  for (const h of colecao) {
    let p = 0;
    if (h.tags.estacao === estacao) p += PESO_ESTACAO;
    if (retrato.energia && h.tags.energia === retrato.energia) p += PESO_ENERGIA;
    if (retrato.temperatura && h.tags.temperatura === retrato.temperatura) p += PESO_TEMPERATURA;
    if (imagens.length && h.tags.imagem.some((im) => imagens.includes(im))) p += PESO_IMAGEM;

    if (p > melhorPontos) {
      melhorPontos = p;
      candidatos = [h];
    } else if (p === melhorPontos) {
      candidatos.push(h);
    }
  }

  // Desempate determinístico entre os de maior pontuação (ordem estável por id).
  candidatos.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rng = mulberry32((semente ^ 0x6a09e667) >>> 0);
  return candidatos[Math.floor(rng() * candidatos.length)];
}
