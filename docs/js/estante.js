// estante.js — batismo das obras: nome e haiku, locais e determinísticos.
//
// Zero rede, zero IA, zero backend: tudo por regras combinatórias sobre
// léxicos em PT-BR (definidos por modo em modos.js). O gesto de guardar
// nunca exige digitação — a obra nasce batizada, e o nome é renomeável na
// estante.
//
// DETERMINÍSTICO: o nome (e o haiku) são semeados por um HASH da própria
// obra (modo + temperatura + hora + nº de estrelas). Assim a mesma obra
// gera sempre o mesmo nome — o batismo é uma leitura da obra, não um
// sorteio que mudaria se recalculado. (E nada disso depende de Math.random.)
//
// Sobre o haiku: é COMBINATÓRIA, não interpretação — versos-molde com
// lacunas preenchidas por fragmentos do léxico. É o teto honesto do que dá
// para fazer offline; com bons fragmentos, soa bonito e quase nunca repete.

import { mulberry32 } from './prng.js';

// Referência temporal (compartilhada entre modos — a hora não muda de
// vocabulário). Períodos com nome próprio dão títulos mais bonitos.
const PERIODOS = [
  { ate: 5, nome: 'da Madrugada', nu: 'madrugada' },
  { ate: 7, nome: 'da Alvorada', nu: 'alvorada' },
  { ate: 11, nome: 'da Manhã', nu: 'manhã' },
  { ate: 13, nome: 'do Meio-Dia', nu: 'luz alta' },
  { ate: 17, nome: 'da Tarde', nu: 'tarde' },
  { ate: 19, nome: 'do Entardecer', nu: 'penumbra' },
  { ate: 22, nome: 'da Noite', nu: 'noite' },
  { ate: 24, nome: 'da Meia-Noite', nu: 'meia-noite' },
];

const HORA_EXTENSO = [
  'das Doze', 'da Uma', 'das Duas', 'das Três', 'das Quatro', 'das Cinco',
  'das Seis', 'das Sete', 'das Oito', 'das Nove', 'das Dez', 'das Onze',
];

// Adjetivos de cor por temperatura, para a lacuna {cor} do haiku.
const ADJ_COR = {
  frio: ['azul', 'índigo', 'prateado', 'glacial', 'sereno'],
  quente: ['âmbar', 'dourado', 'rubro', 'ardente', 'cobre'],
  neutro: ['pálido', 'cinéreo', 'difuso', 'translúcido'],
};

function periodoDe(hora) {
  for (const p of PERIODOS) if (hora < p.ate) return p;
  return PERIODOS[PERIODOS.length - 1];
}

/** Hash determinístico string → uint32 (FNV-1a). Serve de semente do PRNG:
 *  mesma string → mesma semente → mesmo batismo. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Semente do batismo a partir dos atributos da obra. */
export function sementeDaObra({ modo, calidez, timestamp, estrelas = 0 }) {
  return hash(`${modo}|${Math.round(calidez * 100)}|${timestamp}|${estrelas}`);
}

function poolPorCalidez(lexico, calidez) {
  return calidez > 0.15 ? lexico.quentes : calidez < -0.15 ? lexico.frios : lexico.neutros;
}

function tempPorCalidez(calidez) {
  return calidez > 0.15 ? 'quente' : calidez < -0.15 ? 'frio' : 'neutro';
}

const escolher = (rng, lista) => lista[Math.floor(rng() * lista.length)];

/**
 * Gera o nome da obra: [termo do léxico do modo] + [referência de hora].
 * De vez em quando, uma frase poética inteira do léxico.
 *
 * @param {object} modo - configuração do modo (com .lexico)
 * @param {Date} date
 * @param {number} calidez - viés térmico [-1, 1]
 * @param {number} semente - hash da obra (determinismo)
 */
export function gerarNome(modo, date, calidez, semente) {
  const rng = mulberry32(semente);
  const lex = modo.lexico;

  // Às vezes, um nome-frase pronto (mais raro, mais "alto").
  if (rng() < 0.12) return escolher(rng, lex.raras);

  const termo = escolher(rng, poolPorCalidez(lex, calidez));
  const hora = date.getHours();
  const referencia = rng() < 0.35 ? HORA_EXTENSO[hora % 12] : periodoDe(hora).nome;
  return `${termo} ${referencia}`;
}

/**
 * Gera um haiku combinatório (3 versos-molde preenchidos). Determinístico
 * pela mesma semente da obra (deslocada, para não correlacionar com o
 * nome). Não é interpretação — é Mad Libs poético.
 */
export function gerarHaiku(modo, date, calidez, semente) {
  const rng = mulberry32((semente ^ 0x9e3779b9) >>> 0);
  const h = modo.lexico.haiku;
  const cor = escolher(rng, ADJ_COR[tempPorCalidez(calidez)]);
  const periodo = periodoDe(date.getHours()).nu;
  const preencher = (verso) => verso.replace('{cor}', cor).replace('{periodo}', periodo);
  return [preencher(escolher(rng, h.a)), preencher(escolher(rng, h.b)), preencher(escolher(rng, h.c))];
}

/**
 * Gera o POEMA BILÍNGUE da obra para a galeria 3D: três versos (abertura ·
 * meio · fecho) escolhidos de pools PARES {ja, pt} — assim a tradução PT é
 * sempre fiel ao japonês exibido. Determinístico pela semente (hash do id da
 * obra): a mesma obra mostra sempre o mesmo poema.
 *
 * @param {object} modo - configuração do modo (com .lexico.poema)
 * @param {number} semente
 * @returns {{ ja: string[], pt: string[] }}
 */
export function gerarPoema(modo, semente) {
  const p = modo.lexico.poema;
  if (!p) return { ja: [], pt: [] };
  const rng = mulberry32((semente ^ 0x85ebca6b) >>> 0);
  const a = escolher(rng, p.abertura);
  const b = escolher(rng, p.meio);
  const c = escolher(rng, p.fecho);
  return { ja: [a.ja, b.ja, c.ja], pt: [a.pt, b.pt, c.pt] };
}

/** Hora de criação para os metadados: "HH:MM". */
export function horaFormatada(timestamp) {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
