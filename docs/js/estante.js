// estante.js — nomes das obras e formatação dos metadados.
//
// O gesto de guardar nunca exige digitação: cada obra nasce com um nome
// gerado, em PT-BR, combinando um termo de água/luz com uma referência à
// hora em que foi pintada (ex.: "Maré da Meia-Noite", "Âmbar das Três").
// O usuário pode renomear depois, na estante. Funções puras — fáceis de
// calibrar e testar.

// Termos divididos por temperatura: a obra escolhe o vocabulário do seu
// próprio tom (uma obra quente vira "Âmbar", "Brasa"; uma fria, "Maré",
// "Luar"). Assim o nome conversa com a cor sem precisar descrevê-la.
const TERMOS_FRIOS = ['Maré', 'Névoa', 'Luar', 'Vazante', 'Remanso', 'Bruma', 'Sereno', 'Orvalho'];
const TERMOS_QUENTES = ['Âmbar', 'Brasa', 'Crepúsculo', 'Ocaso', 'Lume', 'Reflexo', 'Aurora'];
const TERMOS_NEUTROS = ['Corrente', 'Onda', 'Espelho', 'Murmúrio', 'Deriva', 'Sombra'];

// Referência temporal por faixa de hora (0–23). Períodos com nome próprio
// dão títulos mais bonitos que um relógio cru.
const PERIODOS = [
  { ate: 5, nome: 'da Madrugada' },
  { ate: 7, nome: 'da Alvorada' },
  { ate: 11, nome: 'da Manhã' },
  { ate: 13, nome: 'do Meio-Dia' },
  { ate: 17, nome: 'da Tarde' },
  { ate: 19, nome: 'do Entardecer' },
  { ate: 22, nome: 'da Noite' },
  { ate: 24, nome: 'da Meia-Noite' },
];

// Horas por extenso, para a variante "Âmbar das Três".
const HORA_EXTENSO = [
  'das Doze', 'da Uma', 'das Duas', 'das Três', 'das Quatro', 'das Cinco',
  'das Seis', 'das Sete', 'das Oito', 'das Nove', 'das Dez', 'das Onze',
];

/** O período nomeado de uma hora (0–23). */
function periodoDe(hora) {
  for (const p of PERIODOS) if (hora < p.ate) return p.nome;
  return PERIODOS[PERIODOS.length - 1].nome;
}

/**
 * Gera o nome de uma obra a partir da hora e da temperatura dominante.
 *
 * @param {Date} date - quando a obra foi guardada
 * @param {number} calidez - viés térmico da obra em [-1, 1] (frio→quente)
 * @param {() => number} rng - gerador pseudo-aleatório (determinismo)
 * @returns {string}
 */
export function gerarNome(date, calidez, rng) {
  const pool =
    calidez > 0.15 ? TERMOS_QUENTES : calidez < -0.15 ? TERMOS_FRIOS : TERMOS_NEUTROS;
  const termo = pool[Math.floor(rng() * pool.length)];

  // De vez em quando, a hora cheia por extenso ("das Três") no lugar do
  // período — varia o ritmo dos nomes sem soar aleatório.
  const hora = date.getHours();
  const usaHoraCheia = rng() < 0.35;
  const referencia = usaHoraCheia ? HORA_EXTENSO[hora % 12] : periodoDe(hora);

  return `${termo} ${referencia}`;
}

/** Hora de criação para os metadados: "HH:MM". */
export function horaFormatada(timestamp) {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
