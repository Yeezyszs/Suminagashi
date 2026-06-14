// luz.js — a atmosfera da sala: o sistema de luz de DUAS camadas.
//
// A "luz" não é cromo de interface — é o ar da sala, banhando a tela
// inteira por cima da água. Ela combina duas fontes:
//
//   Camada 1 (o ciclo): o relógio do dispositivo. A hora local vira uma
//     posição contínua do sol — luar frio de madrugada, meio-dia neutro,
//     tarde dourada — transicionando minuto a minuto, sem fases discretas.
//
//   Camada 2 (a fundação): a PRIMEIRA pintura do usuário. Dela extraímos
//     um viés de temperatura que modula o ciclo inteiro. O relógio dá o
//     movimento; a fundação dá o tom. Dois usuários às 18h veem
//     entardeceres diferentes porque fundaram salas diferentes.
//
// Tudo aqui é FUNÇÃO PURA — entra dado, sai dado, nada de DOM — para que a
// calibração (e testes) sejam triviais. A tradução final para pixels é só
// a última função, corDaAtmosfera(), que devolve cores CSS prontas.

// ---------------------------------------------------------------------------
// Camada 1 — o ciclo do relógio
// ---------------------------------------------------------------------------

/**
 * Quadros-chave do dia, de 3 em 3 horas (cíclicos: 24h volta ao 0h).
 * Cada um descreve a luz naquele instante com três escalares normalizados:
 *
 *   luminosidade — 0 (escuro) … ~1.05 (meio-dia estourando de luz)
 *   calidez      — −1 (luar azul) … +1 (âmbar quente); 0 = neutro
 *   vinheta      — 0 (sem) … 1 (cantos densos, sala fechada à noite)
 *
 * São chutes iniciais para sentir no uso — fáceis de calibrar aqui.
 */
const QUADROS = [
  // hora,  luminosidade, calidez, vinheta
  [0, 0.42, -0.55, 0.72], // meia-noite — luar
  [3, 0.4, -0.5, 0.75], //   madrugada
  [6, 0.7, -0.25, 0.45], //  amanhecer — frio clareando
  [9, 0.95, 0.0, 0.22], //   manhã — neutra
  [12, 1.05, 0.05, 0.1], //  meio-dia — clara, vinheta mínima
  [15, 1.0, 0.28, 0.18], //  tarde — começa a dourar
  [18, 0.8, 0.55, 0.4], //   dourada — âmbar quente
  [21, 0.55, 0.3, 0.62], //  anoitecer — quente escurecendo
];

/** Interpolação suave (smoothstep): suaviza as pontas, sem cantos. */
function suave(t) {
  return t * t * (3 - 2 * t);
}

/**
 * A luz do ciclo numa hora qualquer (camada 1).
 *
 * Interpola ciclicamente entre os quadros-chave: acha o par que cerca a
 * hora atual e mistura os dois com smoothstep. Como 0h e 24h são o mesmo
 * ponto, o quadro depois das 21h volta para o das 0h — a virada da noite
 * é tão suave quanto qualquer outra.
 *
 * @param {Date} date
 * @returns {{ luminosidade: number, calidez: number, vinheta: number }}
 */
export function cicloDeLuz(date) {
  const hora =
    date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;

  // Acha o intervalo [a, b] de quadros que contém a hora (com wrap em 24h).
  const passo = 24 / QUADROS.length; // 3h
  const i = Math.floor(hora / passo) % QUADROS.length;
  const j = (i + 1) % QUADROS.length;
  const horaA = QUADROS[i][0];
  // Fração dentro do intervalo (o último intervalo cruza a meia-noite).
  let frac = (hora - horaA) / passo;
  if (frac < 0) frac += 24 / passo; // segurança numérica
  const t = suave(Math.min(Math.max(frac, 0), 1));

  const a = QUADROS[i];
  const b = QUADROS[j];
  return {
    luminosidade: a[1] + (b[1] - a[1]) * t,
    calidez: a[2] + (b[2] - a[2]) * t,
    vinheta: a[3] + (b[3] - a[3]) * t,
  };
}

// ---------------------------------------------------------------------------
// Camada 2 — o tom da fundação
// ---------------------------------------------------------------------------

/**
 * Extrai da primeira pintura um VIÉS DE TEMPERATURA (camada 2).
 *
 * Não nos importa aqui qual a cor exata — só se a sala "puxa" para o quente
 * ou para o frio, e com que força. Percorre os pixels (ignorando os que são
 * ~papel) e soma um voto de calor por pixel: matizes de vermelho/laranja/
 * amarelo votam quente (+), de ciano/azul/roxo votam frio (−), ponderados
 * pela saturação (cinza não tem opinião). A média é a calidez; a fração de
 * pixels com tinta é a força.
 *
 * @param {Uint8Array} pixels - RGBA (como sai do readPixels)
 * @param {number} w
 * @param {number} h
 * @param {[number,number,number]} papel - cor do papel em [0..1]
 * @returns {{ calidez: number, forca: number }} ambos em escala útil
 */
export function extrairTomFundacao(pixels, w, h, papel) {
  let somaCalor = 0;
  let somaPeso = 0;
  let pintados = 0;

  for (let i = 0; i < w * h; i++) {
    const r = pixels[i * 4] / 255;
    const g = pixels[i * 4 + 1] / 255;
    const b = pixels[i * 4 + 2] / 255;

    // Pixel ~papel não diz nada sobre o tom da obra.
    const dist = Math.max(
      Math.abs(r - papel[0]),
      Math.abs(g - papel[1]),
      Math.abs(b - papel[2])
    );
    if (dist < 0.06) continue;
    pintados++;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max - min; // saturação aproximada (peso do voto)
    if (sat < 0.04) continue; // cinza: sem opinião térmica

    // Voto de calor: o quanto o vermelho supera o azul, na escala do matiz.
    // +1 = puramente quente (vermelho), −1 = puramente frio (azul).
    const calor = (r - b) / (sat + 1e-5);
    somaCalor += calor * sat;
    somaPeso += sat;
  }

  if (somaPeso === 0) return { calidez: 0, forca: 0 };
  return {
    calidez: Math.max(-1, Math.min(1, somaCalor / somaPeso)),
    forca: Math.min(1, pintados / (w * h * 0.05)), // ~5% pintado = força plena
  };
}

// ---------------------------------------------------------------------------
// Composição final — o ciclo modulado pela fundação
// ---------------------------------------------------------------------------

/** Quanto a fundação consegue empurrar a calidez do ciclo (em força plena).
 *  Modulação, não substituição: a hora ainda manda no movimento. */
const INFLUENCIA_FUNDACAO = 0.5;

/**
 * atmosfera = cicloDeLuz(agora) modulado por tomDaFundacao.
 *
 * A fundação desloca a calidez do ciclo na sua direção (uma sala fundada
 * em azuis esfria todos os horários; uma fundada em dourados os esquenta)
 * e dá um leve empurrão de luminosidade no mesmo sentido — salas quentes
 * parecem um tiquinho mais acesas. A vinheta vem só do ciclo (é geometria
 * da luz, não temperatura).
 *
 * @param {{luminosidade,calidez,vinheta}} ciclo
 * @param {{calidez,forca}|null} tom - null = sala sem alma ainda (neutra)
 * @returns {{ luminosidade, calidez, vinheta }}
 */
export function comporAtmosfera(ciclo, tom) {
  if (!tom || tom.forca === 0) return { ...ciclo };
  const empurrao = tom.calidez * tom.forca * INFLUENCIA_FUNDACAO;
  return {
    luminosidade: Math.max(0, ciclo.luminosidade + empurrao * 0.06),
    calidez: Math.max(-1, Math.min(1, ciclo.calidez + empurrao)),
    vinheta: ciclo.vinheta,
  };
}

// ---------------------------------------------------------------------------
// Tradução para pixels (a única parte que pensa em CSS)
// ---------------------------------------------------------------------------

/**
 * Converte a atmosfera num gradiente radial pronto para o overlay.
 *
 * O overlay vive POR CIMA de tudo (água, UI, estante), em compositing
 * normal e sem blend-mode — barato. Ele só ESCURECE/tinge, nunca clareia:
 * o meio-dia é simplesmente o overlay quase transparente (a água em papel
 * pleno já é a luz mais clara). A noite é um véu azul denso; a tarde, um
 * âmbar suave. A vinheta é o gradiente ficando mais opaco nas bordas.
 *
 * @param {{luminosidade,calidez,vinheta}} atm
 * @param {number} [escala=1] - multiplica a opacidade do véu. O cosmos usa
 *   um valor menor: o vazio já é escuro, então uma vinheta densa de "papel"
 *   o sufocaria — lá a profundidade vem do próprio vazio, não do overlay.
 * @returns {{ centro: string, borda: string }} cores rgba() do gradiente
 */
export function corDaAtmosfera(atm, escala = 1) {
  // Escuridão geral: 0 ao meio-dia, ~0.6 na calada da noite.
  const escuro = Math.max(0, 1 - atm.luminosidade);

  // Tom do véu pela calidez: âmbar quente ⇄ índigo frio, passando por um
  // cinza-neutro quase imperceptível no meio.
  const quente = [60, 34, 14];
  const frio = [18, 28, 56];
  const neutro = [40, 38, 36];
  const k = atm.calidez;
  const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const cor = k >= 0 ? lerp3(neutro, quente, k) : lerp3(neutro, frio, -k);
  const [vr, vg, vb] = cor.map(Math.round);

  // Alfa no centro vem só da escuridão; nas bordas soma a vinheta.
  const alfaCentro = escuro * 0.5 * escala;
  const alfaBorda = Math.min(0.95, alfaCentro + atm.vinheta * 0.55 * escala);

  return {
    centro: `rgba(${vr}, ${vg}, ${vb}, ${alfaCentro.toFixed(3)})`,
    borda: `rgba(${vr}, ${vg}, ${vb}, ${alfaBorda.toFixed(3)})`,
  };
}
