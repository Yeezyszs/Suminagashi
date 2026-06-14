// fluido.js — motor de suminagashi como simulação de fluido real (WebGL2).
//
// A versão anterior deste projeto (preservada no histórico do git) tratava
// cada gota como um polígono deformado por fórmulas fechadas — o marbling
// "gráfico" de Aubrey Jaffer, de anéis nítidos. Esta versão simula a FÍSICA
// da água de verdade: as equações de Navier-Stokes para um fluido
// incompressível, resolvidas na GPU pelo método "stable fluids" de Jos Stam
// (1999). A tinta vira um corante difuso carregado pela correnteza: ela se
// mistura, esfumaça, forma vórtices — o comportamento aquarelado do
// suminagashi numa bacia real.
//
// Por que GPU? A simulação trabalha com duas grades (velocidade e tinta)
// re-calculadas inteiras a cada quadro, ~10 passadas por quadro sobre
// centenas de milhares de células. É o tipo de trabalho massivamente
// paralelo em que uma GPU de celular é centenas de vezes mais rápida que a
// CPU — por isso este visual só existe em WebGL.
//
// O ciclo de um quadro (cada passo é um shader desenhando num framebuffer):
//
//   1. ADVECÇÃO da velocidade — a correnteza carrega a si mesma
//   2. VORTICIDADE — devolve os redemoinhos que a grade borra
//   3. ONDULAÇÃO — a "respiração" da água (correnteza ambiente sutil)
//   4. CONTORNO — as paredes da bacia refletem a tinta de volta
//   5. DIVERGÊNCIA + PRESSÃO + PROJEÇÃO — impõe incompressibilidade
//   6. ADVECÇÃO da tinta — a correnteza carrega o corante
//
// Este módulo conhece WebGL mas não conhece a página: recebe o canvas e
// comandos (pingar, mexer, lavar) e cuida só da física e da imagem.

// ---------------------------------------------------------------------------
// Constantes da simulação
// ---------------------------------------------------------------------------

/** Resolução da grade de VELOCIDADE (lado menor, células). A correnteza é
 *  suave por natureza; uma grade grossa basta e mantém o custo mínimo. */
export const RES_VELOCIDADE = 176;

/** Resolução da grade de TINTA (lado menor, células). Mais fina que a de
 *  velocidade: é nela que o olho repara — bordas e filamentos do corante. */
export const RES_TINTA = 1024;

/** Dissipação da velocidade (1/s). A correnteza perde energia devagar:
 *  valores baixos = a água continua se mexendo muito tempo depois do
 *  gesto. Calibrado para um deslizar longo mas que assenta — água numa
 *  bacia rasa, não tempestade. */
export const DISSIPACAO_VELOCIDADE = 0.45;

/** Dissipação da tinta (1/s). Zero: tinta pingada não evapora — a obra
 *  fica. (O botão lavar usa outro mecanismo, o desbotamento.) */
export const DISSIPACAO_TINTA = 0;

/** Teto da densidade óptica por canal. exp(-8) ≈ 0.0003: além disso o
 *  pixel já é visualmente preto — acumular mais só desperdiçaria a faixa
 *  do half-float e deixaria o "lavar" e a água mais lentos para diluir. */
export const DENSIDADE_MAXIMA = 8;

/** Quanta densidade uma gota de "água" remove no centro do splat. No
 *  suminagashi real a "água" leva dispersante: ela ABRE a tinta, diluindo
 *  o pigmento localmente — é isso que desenha os anéis claros. */
export const DILUICAO_AGUA = 3;

/** Iterações de Jacobi do solucionador de pressão. Mais iterações = fluido
 *  mais rigorosamente incompressível, porém mais caro. ~24 é o ponto doce
 *  visual: abaixo disso a tinta "infla" perceptivelmente nos gestos. */
export const ITERACOES_PRESSAO = 24;

/** Força do confinamento de vorticidade. A advecção numérica borra os
 *  pequenos redemoinhos; este passo os detecta e re-amplifica. Com
 *  moderação: forte demais, ele amplifica ruído na escala da célula e a
 *  tinta ganha bordas serrilhadas ("dentes" do tamanho da grade) — e ele
 *  nunca dorme: com a água quase parada, continuaria enrugando as bordas
 *  para sempre. */
export const VORTICIDADE = 2.5;

/** Nitidez da tinta: quanto da correção MacCormack entra no resultado
 *  (1 = correção total, 0 = advecção simples). A correção devolve a
 *  nitidez que a interpolação rouba — mas em dose plena preserva até o
 *  ruído de alta frequência, e a obra parada fica "crocante", granulada.
 *  Tinta real tem difusão molecular: as micro-rugas se dissolvem em
 *  gradientes cremosos e só as formas grandes permanecem. Este valor é o
 *  ponto de equilíbrio: filamentos vivos, superfície limpa. */
export const NITIDEZ_TINTA = 0.72;

/** Quanto da pressão sobrevive de um quadro para o outro (chute inicial
 *  do Jacobi — começar perto da solução anterior converge mais rápido). */
export const RETENCAO_PRESSAO = 0.8;

/** Força do empurrão radial de uma gota nova (unidades da simulação).
 *  É o que faz a gota abrir espaço, empurrando a tinta vizinha em anel. */
export const FORCA_GOTA = 90;

// (O estilete não tem constante de força: ele IMPÕE a velocidade do dedo
// à água sob ele — ver mexer(). Auto-limitado por construção: a tinta
// nunca corre mais rápido que o gesto.)

/** Ondas da "respiração" da água: função de corrente ψ com duas escalas
 *  (uma larga e preguiçosa, uma curta que tremula as bordas), fases
 *  evoluindo em ~20–30s. Mesma matemática da versão CPU deste projeto —
 *  agora avaliada na GPU, uma célula por thread. As amplitudes são
 *  ACELERAÇÕES (px/s²): a correnteza ambiente é injetada aos poucos e a
 *  dissipação a equilibra num vaguear sutil e perpétuo. */
export const ONDAS = [
  { amp: 2.6, lx: 420, ly: 360, w1: 0.23, w2: -0.19 },
  // A onda fina é a mais delicada: forte ou curta demais, ela fica
  // franzindo as bordas da tinta parada em vez de fazê-la respirar.
  { amp: 0.5, lx: 230, ly: 210, w1: -0.31, w2: 0.26 },
];

/** Teto de devicePixelRatio (nitidez × custo de rasterização). */
export const DPR_MAXIMO = 2;

// ---------------------------------------------------------------------------
// Shaders (GLSL ES 3.0)
// ---------------------------------------------------------------------------

// Vértice comum a todos os passos: um triângulo que cobre a tela inteira.
// Todo o trabalho acontece nos fragment shaders, uma célula por pixel.
const VS_TELA = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// ADVECÇÃO semi-lagrangiana (o coração do método de Stam): em vez de
// empurrar o valor de cada célula para frente (instável), cada célula
// pergunta "que valor estava aqui um instante atrás?" e busca a resposta
// RECUANDO pela correnteza: origem = posição − velocidade·dt. A
// interpolação bilinear da textura faz a mistura suave de graça. É
// incondicionalmente estável: o fluido nunca explode, só amacia.
const FS_ADVECCAO = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 saida;
uniform sampler2D uVelocidade;
uniform sampler2D uFonte;
uniform vec2 uTexel;       // 1/resolução da grade de velocidade
uniform float uDt;
uniform float uDissipacao; // perda exponencial por segundo
void main() {
  vec2 vel = texture(uVelocidade, vUv).xy;
  vec2 origem = vUv - uDt * vel * uTexel;
  vec4 valor = texture(uFonte, origem);
  saida = valor / (1.0 + uDissipacao * uDt);
}`;

// CORREÇÃO DE MacCORMACK: a advecção semi-lagrangiana simples tem DIFUSÃO
// NUMÉRICA — a interpolação bilinear borra um pouquinho a cada quadro, e
// em minutos a obra inteira vira uma lama cinza sem filamentos. O esquema
// de MacCormack mede esse erro e o compensa: advecta para frente (φ1),
// advecta φ1 de VOLTA no tempo (φ2) e compara com o original — se a
// advecção fosse perfeita, φ2 == φ0; a diferença é o erro, e somamos
// metade dele ao resultado. Isso recupera quase toda a nitidez (precisão
// de 2ª ordem) pelo preço de uma textura a mais.
//
// O clamp final limita o valor corrigido ao intervalo dos 4 vizinhos da
// célula de origem: sem ele a compensação cria overshoots — cores que
// nunca existiram na bacia (franjas psicodélicas nas bordas).
const FS_MACCORMACK = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 saida;
uniform sampler2D uVelocidade;
uniform sampler2D uFonte;      // φ0 — a tinta original
uniform sampler2D uPrevisto;   // φ1 — advecção simples já feita
uniform vec2 uTexel;           // texel da grade de velocidade
uniform vec2 uTexelFonte;      // texel da grade de tinta
uniform float uDt;
uniform float uNitidez;        // 0 = só advecção suave, 1 = correção plena
void main() {
  vec2 vel = texture(uVelocidade, vUv).xy;

  // φ2: leva o previsto DE VOLTA no tempo (traço para a frente).
  vec4 phi2 = texture(uPrevisto, vUv + uDt * vel * uTexel);
  vec4 phi0 = texture(uFonte, vUv);
  vec4 phi1 = texture(uPrevisto, vUv);
  vec4 corrigido = phi1 + 0.5 * (phi0 - phi2);

  // Intervalo permitido: os 4 texels que cercam a origem do traço.
  vec2 origem = vUv - uDt * vel * uTexel;
  vec2 base = (floor(origem / uTexelFonte - 0.5) + 0.5) * uTexelFonte;
  vec4 a = texture(uFonte, base);
  vec4 b = texture(uFonte, base + vec2(uTexelFonte.x, 0.0));
  vec4 c = texture(uFonte, base + vec2(0.0, uTexelFonte.y));
  vec4 d = texture(uFonte, base + uTexelFonte);
  vec4 nitido = clamp(corrigido, min(min(a, b), min(c, d)), max(max(a, b), max(c, d)));

  // Dose de nitidez: misturar a correção com a advecção suave equivale a
  // uma leve DIFUSÃO — as micro-rugas se dissolvem como na tinta real
  // (difusão molecular), e só as formas que importam permanecem.
  saida = mix(phi1, nitido, uNitidez);
}`;

// DIVERGÊNCIA: mede, célula a célula, quanto a correnteza está "criando"
// ou "engolindo" fluido (diferenças centrais dos vizinhos). Água real é
// incompressível: divergência deve ser zero. O que sobrar aqui será
// removido pelos passos de pressão.
const FS_DIVERGENCIA = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 saida;
uniform sampler2D uVelocidade;
uniform vec2 uTexel;
void main() {
  float E = texture(uVelocidade, vUv + vec2(uTexel.x, 0.0)).x;
  float O = texture(uVelocidade, vUv - vec2(uTexel.x, 0.0)).x;
  float N = texture(uVelocidade, vUv + vec2(0.0, uTexel.y)).y;
  float S = texture(uVelocidade, vUv - vec2(0.0, uTexel.y)).y;
  saida = vec4(0.5 * (E - O + N - S), 0.0, 0.0, 1.0);
}`;

// PRESSÃO (uma iteração de Jacobi): resolve ∇²p = divergência por
// relaxamento — cada célula vira a média dos vizinhos menos a divergência
// local. Repetido N vezes, converge para o campo de pressão que, subtraído
// da velocidade, torna o fluido incompressível.
const FS_PRESSAO = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 saida;
uniform sampler2D uPressao;
uniform sampler2D uDivergencia;
uniform vec2 uTexel;
void main() {
  float E = texture(uPressao, vUv + vec2(uTexel.x, 0.0)).x;
  float O = texture(uPressao, vUv - vec2(uTexel.x, 0.0)).x;
  float N = texture(uPressao, vUv + vec2(0.0, uTexel.y)).x;
  float S = texture(uPressao, vUv - vec2(0.0, uTexel.y)).x;
  float div = texture(uDivergencia, vUv).x;
  saida = vec4((E + O + N + S - div) * 0.25, 0.0, 0.0, 1.0);
}`;

// PROJEÇÃO: subtrai o gradiente da pressão da velocidade. Pelo teorema de
// Helmholtz-Hodge, o que resta é a parte do campo livre de divergência —
// a correnteza fisicamente possível.
const FS_PROJECAO = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 saida;
uniform sampler2D uPressao;
uniform sampler2D uVelocidade;
uniform vec2 uTexel;
void main() {
  float E = texture(uPressao, vUv + vec2(uTexel.x, 0.0)).x;
  float O = texture(uPressao, vUv - vec2(uTexel.x, 0.0)).x;
  float N = texture(uPressao, vUv + vec2(0.0, uTexel.y)).x;
  float S = texture(uPressao, vUv - vec2(0.0, uTexel.y)).x;
  vec2 vel = texture(uVelocidade, vUv).xy;
  saida = vec4(vel - 0.5 * vec2(E - O, N - S), 0.0, 1.0);
}`;

// CONTORNO: as paredes da bacia. Em cada célula da borda, a componente
// NORMAL da velocidade recebe o NEGATIVO da célula interior vizinha. Com
// isso a velocidade na interface com a parede tem média zero — condição de
// NÃO-PENETRAÇÃO: a correnteza não atravessa a borda. Quando a tinta se
// aproxima, ela é barrada, a pressão se acumula contra a parede e empurra
// tudo de volta para dentro — é assim que a tinta "bate na borda e volta",
// sem nenhum caso especial: só física. A componente tangencial passa
// intacta (parede escorregadia, free-slip), então a tinta desliza ao longo
// da margem em vez de grudar — o que parece mais água do que cola.
const FS_CONTORNO = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 saida;
uniform sampler2D uVelocidade;
uniform vec2 uTexel;
void main() {
  vec2 v = texture(uVelocidade, vUv).xy;
  if (vUv.x < uTexel.x)            v.x = -texture(uVelocidade, vUv + vec2(uTexel.x, 0.0)).x;
  else if (vUv.x > 1.0 - uTexel.x) v.x = -texture(uVelocidade, vUv - vec2(uTexel.x, 0.0)).x;
  if (vUv.y < uTexel.y)            v.y = -texture(uVelocidade, vUv + vec2(0.0, uTexel.y)).y;
  else if (vUv.y > 1.0 - uTexel.y) v.y = -texture(uVelocidade, vUv - vec2(0.0, uTexel.y)).y;
  saida = vec4(v, 0.0, 1.0);
}`;

// ROTACIONAL (curl): intensidade de rotação local da correnteza.
const FS_ROTACIONAL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 saida;
uniform sampler2D uVelocidade;
uniform vec2 uTexel;
void main() {
  float E = texture(uVelocidade, vUv + vec2(uTexel.x, 0.0)).y;
  float O = texture(uVelocidade, vUv - vec2(uTexel.x, 0.0)).y;
  float N = texture(uVelocidade, vUv + vec2(0.0, uTexel.y)).x;
  float S = texture(uVelocidade, vUv - vec2(0.0, uTexel.y)).x;
  saida = vec4(0.5 * ((E - O) - (N - S)), 0.0, 0.0, 1.0);
}`;

// CONFINAMENTO DE VORTICIDADE: a advecção numérica dissipa os redemoinhos
// pequenos (difusão numérica). Este passo encontra onde eles estão (pelo
// rotacional) e os realimenta com uma força perpendicular ao gradiente da
// sua intensidade — devolvendo ao fluido as espirais finas que fazem o
// marmorizado parecer vivo. Técnica de Fedkiw et al. (2001).
const FS_VORTICIDADE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 saida;
uniform sampler2D uVelocidade;
uniform sampler2D uRotacional;
uniform vec2 uTexel;
uniform float uForca;
uniform float uDt;
void main() {
  float E = texture(uRotacional, vUv + vec2(uTexel.x, 0.0)).x;
  float O = texture(uRotacional, vUv - vec2(uTexel.x, 0.0)).x;
  float N = texture(uRotacional, vUv + vec2(0.0, uTexel.y)).x;
  float S = texture(uRotacional, vUv - vec2(0.0, uTexel.y)).x;
  float C = texture(uRotacional, vUv).x;

  // Gradiente da |vorticidade|, normalizado: aponta para o centro do
  // redemoinho mais próximo. A força é perpendicular a ele.
  vec2 forca = 0.5 * vec2(abs(N) - abs(S), abs(E) - abs(O));
  forca /= length(forca) + 1e-4;
  forca *= uForca * C * vec2(1.0, -1.0);

  vec2 vel = texture(uVelocidade, vUv).xy;
  saida = vec4(vel + forca * uDt, 0.0, 1.0);
}`;

// ONDULAÇÃO: a "respiração" da água. Mesma ideia da função de corrente ψ
// da versão CPU: aceleração a = (∂ψ/∂y, −∂ψ/∂x), incompressível por
// construção, com duas ondas senoidais cujas fases evoluem no tempo. A
// dissipação da velocidade equilibra essa injeção contínua num vaguear
// perpétuo e sutil — a bacia nunca está morta.
const FS_ONDULACAO = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 saida;
uniform sampler2D uVelocidade;
uniform vec2 uDimensao;  // tamanho do canvas em px CSS (ondas medidas em px)
uniform float uTempo;
uniform float uDt;
uniform vec4 uOnda1;     // (amp, kx, ky, —) e fases via uFases
uniform vec4 uOnda2;
uniform vec4 uFases;     // (w1a, w2a, w1b, w2b)
void main() {
  vec2 p = vUv * uDimensao;
  vec2 a = vec2(0.0);

  float fx1 = p.x * uOnda1.y + uFases.x * uTempo;
  float fy1 = p.y * uOnda1.z + uFases.y * uTempo;
  a += uOnda1.x * vec2(uOnda1.z * sin(fx1) * cos(fy1),
                       -uOnda1.y * cos(fx1) * sin(fy1));

  float fx2 = p.x * uOnda2.y + uFases.z * uTempo;
  float fy2 = p.y * uOnda2.z + uFases.w * uTempo;
  a += uOnda2.x * vec2(uOnda2.z * sin(fx2) * cos(fy2),
                       -uOnda2.y * cos(fx2) * sin(fy2));

  vec2 vel = texture(uVelocidade, vUv).xy;
  saida = vec4(vel + a * uDt, 0.0, 1.0);
}`;

// SPLAT: injeta algo (tinta ou correnteza) num ponto, com queda gaussiana.
// Modos:
//   0 — somar vetor à velocidade
//   1 — somar DENSIDADE de pigmento (gota de tinta; ver FS_EXIBIR para a
//       física — somar densidades é o que faz azul + amarelo = verde)
//   2 — somar empurrão RADIAL à velocidade (gota abrindo espaço em anel)
//   3 — IMPOR vetor à velocidade (estilete: a água sob o dedo adota a
//       velocidade do gesto — arrasto sem deslizamento, como um bastão
//       de verdade na água; auto-limitado, nunca acumula além do gesto)
//   4 — DILUIR: subtrai densidade (gota de água com dispersante abrindo
//       a tinta — clamp em zero: não existe pigmento negativo)
const FS_SPLAT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 saida;
uniform sampler2D uAlvo;
uniform vec2 uPonto;       // centro, em coordenadas de textura
uniform vec3 uValor;       // vetor (modos 0/2/3) ou densidade (1/4)
uniform float uRaio;       // raio² gaussiano, corrigido por proporção
uniform float uProporcao;  // largura/altura do canvas
uniform float uDensidadeMax;
uniform int uModo;
void main() {
  vec2 d = vUv - uPonto;
  d.x *= uProporcao;       // sem isso o círculo viraria elipse
  float g = exp(-dot(d, d) / uRaio);
  vec4 base = texture(uAlvo, vUv);
  if (uModo == 0) {
    saida = vec4(base.xy + uValor.xy * g, 0.0, 1.0);
  } else if (uModo == 1) {
    saida = vec4(min(base.rgb + uValor * g, vec3(uDensidadeMax)), 1.0);
  } else if (uModo == 2) {
    vec2 dir = d / (length(d) + 1e-5);
    saida = vec4(base.xy + dir * uValor.x * g, 0.0, 1.0);
  } else if (uModo == 3) {
    saida = vec4(mix(base.xy, uValor.xy, clamp(g, 0.0, 1.0)), 0.0, 1.0);
  } else {
    saida = vec4(max(base.rgb - uValor * g, vec3(0.0)), 1.0);
  }
}`;

// DESBOTAR: mistura a tinta em direção a uma cor fixa (o papel). Usado
// pelo lavar (fade suave) e, com fator pequeno, para amortecer a pressão
// entre quadros (mesma matemática, alvo zero).
const FS_DESBOTAR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 saida;
uniform sampler2D uAlvo;
uniform vec3 uCor;
uniform float uFator;
void main() {
  vec4 base = texture(uAlvo, vUv);
  saida = vec4(mix(base.rgb, uCor, uFator), 1.0);
}`;

// EXIBIÇÃO: converte densidade de pigmento em cor (lei de Beer-Lambert).
//
// A textura de tinta não guarda COR — guarda DENSIDADE ÓPTICA por canal
// (quanto pigmento absorvendo luz há em cada ponto). A cor que o olho vê
// é a luz do papel atravessando esse pigmento:
//
//     cor = papel · exp(−D)
//
// É a física de tinta de verdade (mistura SUBTRATIVA): pigmento azul
// absorve vermelho, pigmento amarelo absorve azul — onde os dois se
// misturam, sobra o verde. Somar densidades equivale a multiplicar
// transmitâncias: exp(−D₁)·exp(−D₂) = exp(−(D₁+D₂)). Em RGB aditivo,
// azul + amarelo daria um cinza lavado; em Beer-Lambert dá verde, e
// muitas camadas escurecem naturalmente, como tinta real saturando.
const FS_EXIBIR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 saida;
uniform sampler2D uTinta;
uniform vec3 uFundo;    // água: papel washi; cosmos: vazio profundo
uniform int uModo;      // 0 = subtrativo (absorção); 1 = aditivo (emissão)
uniform float uBrilho;  // cosmos: ganho de emissão (dia/noite)
void main() {
  vec3 d = texture(uTinta, vUv).rgb;
  vec3 cor;
  if (uModo == 0) {
    // ÁGUA — Beer-Lambert: a tinta ABSORVE a luz do papel (escurece).
    cor = uFundo * exp(-d);
  } else {
    // COSMOS — pintura de luz: o buffer acumula LUZ colorida; o tonemap
    // 1 − exp(−x) a satura suave sobre o vazio (acumular muito brilha
    // intenso, mas nunca vira um branco chapado). As estrelas (que
    // florescem do acúmulo) são desenhadas por cima, à parte.
    cor = uFundo + (1.0 - exp(-d * uBrilho));
  }
  saida = vec4(cor, 1.0);
}`;

// SOPRO — espalha a luz JÁ depositada na direção do gesto (véus, caudas de
// nebulosa). Não é advecção contínua: é um deslocamento LOCAL aplicado só
// enquanto o dedo se move. Dentro do pincel, cada pixel adota a luz que
// estava "atrás" dele no sentido do gesto — a luz escorre na direção.
const FS_SOPRO = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 saida;
uniform sampler2D uAlvo;
uniform vec2 uPonto;      // centro do sopro (uv)
uniform vec2 uDir;        // direção do gesto (uv/quadro)
uniform float uRaio;      // raio² gaussiano
uniform float uProporcao;
uniform float uForca;
void main() {
  vec2 dd = vUv - uPonto;
  dd.x *= uProporcao;
  float g = exp(-dot(dd, dd) / uRaio);
  vec3 atras = texture(uAlvo, vUv - uDir * uForca * g).rgb;
  vec3 base = texture(uAlvo, vUv).rgb;
  saida = vec4(mix(base, atras, g), 1.0);
}`;

// ASSENTAR — a luz recém-pintada "acomoda": uma difusão levíssima (média
// dos vizinhos) aplicada por ~1-2s após o gesto, decaindo até parar. NÃO é
// simulação perpétua — é um easing pós-gesto com fim definido (ver o loop).
const FS_DIFUSO = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 saida;
uniform sampler2D uAlvo;
uniform vec2 uTexel;
uniform float uQtd;
void main() {
  vec3 c = texture(uAlvo, vUv).rgb;
  vec3 m = (texture(uAlvo, vUv + vec2(uTexel.x, 0.0)).rgb +
            texture(uAlvo, vUv - vec2(uTexel.x, 0.0)).rgb +
            texture(uAlvo, vUv + vec2(0.0, uTexel.y)).rgb +
            texture(uAlvo, vUv - vec2(0.0, uTexel.y)).rgb) * 0.25;
  saida = vec4(mix(c, m, uQtd), 1.0);
}`;

// ESTRELAS (modo cosmos) — pontos de luz nítidos que NÃO são fluido: não
// advectam, ficam fixos enquanto o gás flui por trás. Desenhados como
// gl.POINTS com blend ADITIVO, numa passada própria por cima do campo.
const VS_ESTRELA = `#version 300 es
layout(location = 0) in vec2 aPos;    // posição em clip space (-1..1)
layout(location = 1) in float aTam;   // tamanho como fração da altura do alvo
layout(location = 2) in vec3 aCor;
layout(location = 3) in float aBrilho;
layout(location = 4) in float aFase;  // fase da cintilação (varia por estrela)
uniform float uAltura;  // altura do alvo em px → tamanho do ponto
uniform float uTempo;   // s, para a cintilação
uniform float uCintila; // 1 = cintila; 0 = parado (prefers-reduced-motion)
out vec3 vCor;
out float vBrilho;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  gl_PointSize = max(2.0, aTam * uAltura);
  float tw = mix(1.0, 0.72 + 0.28 * sin(uTempo * 2.5 + aFase), uCintila);
  vCor = aCor;
  vBrilho = aBrilho * tw;
}`;

const FS_ESTRELA = `#version 300 es
precision highp float;
in vec3 vCor;
in float vBrilho;
out vec4 saida;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;                 // 0 no centro, 1 na borda
  float nucleo = smoothstep(0.4, 0.0, r);    // o ponto nítido da estrela
  float glow = exp(-r * r * 5.0);            // o halo suave ao redor
  float i = (nucleo + glow * 0.5) * vBrilho;
  saida = vec4(vCor * i, 1.0);               // blend ONE,ONE soma a luz
}`;

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

/**
 * Cria o motor de fluido preso a um canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {[number, number, number]} corPapel - RGB do papel em [0, 1]
 * @param {{ resTinta?: number }} [opcoes] - resTinta sobrescreve a
 *   resolução da grade de tinta (lado menor). Maior = mais detalhe real e
 *   exportações mais nítidas, porém mais caro: quem chama decide conforme
 *   o aparelho. A grade de VELOCIDADE fica fixa de propósito — a correnteza
 *   é suave e as constantes do motor são calibradas nela.
 * @returns o motor, ou lança Error se WebGL2 + texturas float não existirem
 */
export function criarFluido(canvas, corPapel, opcoes = {}) {
  const resTinta = opcoes.resTinta || RES_TINTA;
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: false,
  });
  if (!gl) throw new Error('WebGL2 indisponível neste navegador.');
  // Texturas float de 16 bits: precisamos delas porque velocidade e
  // pressão têm sinal e ultrapassam [0,1]. Suportado em todo navegador
  // moderno, mas a verificação evita uma tela silenciosamente preta.
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('Texturas float não suportadas (EXT_color_buffer_float).');
  }

  // --- triângulo de tela cheia (3 vértices cobrem tudo; mais simples que
  //     um quad e sem costura diagonal) -----------------------------------
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // --- compilação dos programas ------------------------------------------
  function compilar(tipo, fonte) {
    const s = gl.createShader(tipo);
    gl.shaderSource(s, fonte);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('Erro de shader: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }
  const vsComum = compilar(gl.VERTEX_SHADER, VS_TELA);

  function programa(fsFonte) {
    const p = gl.createProgram();
    gl.attachShader(p, vsComum);
    gl.attachShader(p, compilar(gl.FRAGMENT_SHADER, fsFonte));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Erro de link: ' + gl.getProgramInfoLog(p));
    }
    // Mapa de uniforms (consultar a cada quadro seria desperdício).
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const nome = gl.getActiveUniform(p, i).name;
      uniforms[nome] = gl.getUniformLocation(p, nome);
    }
    return { p, u: uniforms };
  }

  const progAdveccao = programa(FS_ADVECCAO);
  const progMacCormack = programa(FS_MACCORMACK);
  const progDivergencia = programa(FS_DIVERGENCIA);
  const progPressao = programa(FS_PRESSAO);
  const progProjecao = programa(FS_PROJECAO);
  const progContorno = programa(FS_CONTORNO);
  const progRotacional = programa(FS_ROTACIONAL);
  const progVorticidade = programa(FS_VORTICIDADE);
  const progOndulacao = programa(FS_ONDULACAO);
  const progSplat = programa(FS_SPLAT);
  const progDesbotar = programa(FS_DESBOTAR);
  const progExibir = programa(FS_EXIBIR);
  const progSopro = programa(FS_SOPRO); // cosmos: espalhar luz
  const progDifuso = programa(FS_DIFUSO); // cosmos: assentar a luz

  // Programa das estrelas: usa um vertex shader próprio (não o VS_TELA),
  // então tem seu próprio link (com locations via layout no GLSL).
  function programaVF(vsFonte, fsFonte) {
    const p = gl.createProgram();
    gl.attachShader(p, compilar(gl.VERTEX_SHADER, vsFonte));
    gl.attachShader(p, compilar(gl.FRAGMENT_SHADER, fsFonte));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Erro de link (estrela): ' + gl.getProgramInfoLog(p));
    }
    const uniforms = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const nome = gl.getActiveUniform(p, i).name;
      uniforms[nome] = gl.getUniformLocation(p, nome);
    }
    return { p, u: uniforms };
  }
  const progEstrela = programaVF(VS_ESTRELA, FS_ESTRELA);

  // Buffer das estrelas: 8 floats por estrela
  // [clipX, clipY, tamFrac, r, g, b, brilho, fase].
  const STRIDE_ESTRELA = 8;
  const vaoEstrela = gl.createVertexArray();
  const vboEstrela = gl.createBuffer();
  gl.bindVertexArray(vaoEstrela);
  gl.bindBuffer(gl.ARRAY_BUFFER, vboEstrela);
  const bytes = STRIDE_ESTRELA * 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, bytes, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, bytes, 8);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, bytes, 12);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, bytes, 24);
  gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, bytes, 28);
  gl.bindVertexArray(vao);
  let numEstrelas = 0;

  // Estado de composição (como a densidade vira pixel). O fluido em si é
  // idêntico nos dois modos — só esta leitura final muda.
  let fundo = [corPapel[0], corPapel[1], corPapel[2]]; // cor base atrás do fluido
  let modoRender = 0; // 0 = água (subtrativo); 1 = cosmos (aditivo)
  let brilhoCosmos = 1; // ganho de emissão do cosmos (dia/noite)

  // Multiplicador do relógio da ondulação (o "temperamento" da água, que
  // o ritual calibra: gesto calmo → respiração mais lenta).
  let ritmoOndulacao = 1;
  let tempoOnda = 0; // relógio interno acumulado (contínuo mesmo se o ritmo mudar)

  // --- framebuffers das grades --------------------------------------------
  function criarAlvo(w, h, formatoInterno, formato, filtro, tipo = gl.HALF_FLOAT) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtro);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtro);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, formatoInterno, w, h, 0, formato, tipo, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  // Grades com escrita e leitura simultâneas precisam de DUPLO BUFFER
  // (não se pode ler e escrever a mesma textura num passo): escreve-se na
  // cópia, troca-se os papéis.
  function criarDuplo(w, h, fi, f, filtro) {
    return {
      lê: criarAlvo(w, h, fi, f, filtro),
      escreve: criarAlvo(w, h, fi, f, filtro),
      trocar() {
        const t = this.lê;
        this.lê = this.escreve;
        this.escreve = t;
      },
    };
  }

  let velocidade, tinta, tintaIntermedia, pressao, divergencia, rotacional;
  let texelVel = [0, 0];
  let texelTinta = [0, 0];
  let dimsTinta = [0, 0]; // dimensões reais da grade de tinta (px)
  let proporcao = 1;

  /** Dimensiona uma grade pela RESOLUÇÃO do lado menor, mantendo a
   *  proporção do canvas (células sempre quadradas). */
  function dimensoes(res) {
    const aspecto = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
    return aspecto >= 1
      ? [Math.round(res * aspecto), res]
      : [res, Math.round(res / aspecto)];
  }

  function redimensionar() {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAXIMO);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    proporcao = canvas.clientWidth / Math.max(canvas.clientHeight, 1);

    // Redimensionar descarta a obra (raro: rotação de tela). Preservar o
    // conteúdo exigiria re-advectar entre grades; não vale a complexidade.
    const [vw, vh] = dimensoes(RES_VELOCIDADE);
    const [tw, th] = dimensoes(resTinta);
    dimsTinta = [tw, th];
    texelVel = [1 / vw, 1 / vh];
    texelTinta = [1 / tw, 1 / th];

    velocidade = criarDuplo(vw, vh, gl.RG16F, gl.RG, gl.LINEAR);
    tinta = criarDuplo(tw, th, gl.RGBA16F, gl.RGBA, gl.LINEAR);
    // Alvo intermediário da advecção MacCormack (guarda o φ1 previsto).
    tintaIntermedia = criarAlvo(tw, th, gl.RGBA16F, gl.RGBA, gl.LINEAR);
    pressao = criarDuplo(vw, vh, gl.R16F, gl.RED, gl.NEAREST);
    divergencia = criarAlvo(vw, vh, gl.R16F, gl.RED, gl.NEAREST);
    rotacional = criarAlvo(vw, vh, gl.R16F, gl.RED, gl.NEAREST);

    // A bacia começa sem pigmento: densidade zero = papel limpo
    // (exp(−0) = 1, o pixel mostra a cor do papel intacta).
    gl.bindFramebuffer(gl.FRAMEBUFFER, tinta.lê.fbo);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // --- utilitários de passada ----------------------------------------------
  function passada(prog, alvo) {
    gl.useProgram(prog.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, alvo ? alvo.fbo : null);
    gl.viewport(0, 0, alvo ? alvo.w : canvas.width, alvo ? alvo.h : canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function ligarTextura(unidade, tex) {
    gl.activeTexture(gl.TEXTURE0 + unidade);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    return unidade;
  }

  // -------------------------------------------------------------------------
  // Um passo de simulação
  // -------------------------------------------------------------------------

  /**
   * Avança a física dt segundos (ver o roteiro de passos no topo).
   *
   * @param {number} dt - passo (s), já limitado por quem chama
   * @param {number} fatorOndulacao - intensidade da respiração ambiente,
   *   0..1. Zero desliga (prefers-reduced-motion); valores intermediários
   *   servem ao "assentamento" do ritual, quando a água se aquieta
   *   gradualmente. O relógio das ondas é interno e avança em
   *   dt·ritmoOndulacao — contínuo mesmo quando o ritmo muda.
   */
  function passo(dt, fatorOndulacao) {
    gl.bindVertexArray(vao);
    tempoOnda += dt * ritmoOndulacao;

    // 1. A correnteza carrega a si mesma.
    gl.useProgram(progAdveccao.p);
    gl.uniform1i(progAdveccao.u.uVelocidade, ligarTextura(0, velocidade.lê.tex));
    gl.uniform1i(progAdveccao.u.uFonte, 0); // a própria velocidade
    gl.uniform2f(progAdveccao.u.uTexel, texelVel[0], texelVel[1]);
    gl.uniform1f(progAdveccao.u.uDt, dt);
    gl.uniform1f(progAdveccao.u.uDissipacao, DISSIPACAO_VELOCIDADE);
    passada(progAdveccao, velocidade.escreve);
    velocidade.trocar();

    // 2. Reaviva os redemoinhos que a advecção borrou.
    gl.useProgram(progRotacional.p);
    gl.uniform1i(progRotacional.u.uVelocidade, ligarTextura(0, velocidade.lê.tex));
    gl.uniform2f(progRotacional.u.uTexel, texelVel[0], texelVel[1]);
    passada(progRotacional, rotacional);

    gl.useProgram(progVorticidade.p);
    gl.uniform1i(progVorticidade.u.uVelocidade, ligarTextura(0, velocidade.lê.tex));
    gl.uniform1i(progVorticidade.u.uRotacional, ligarTextura(1, rotacional.tex));
    gl.uniform2f(progVorticidade.u.uTexel, texelVel[0], texelVel[1]);
    gl.uniform1f(progVorticidade.u.uForca, VORTICIDADE);
    gl.uniform1f(progVorticidade.u.uDt, dt);
    passada(progVorticidade, velocidade.escreve);
    velocidade.trocar();

    // 3. A água respira (com a intensidade pedida).
    if (fatorOndulacao > 0) {
      gl.useProgram(progOndulacao.p);
      gl.uniform1i(progOndulacao.u.uVelocidade, ligarTextura(0, velocidade.lê.tex));
      gl.uniform2f(progOndulacao.u.uDimensao, canvas.clientWidth, canvas.clientHeight);
      gl.uniform1f(progOndulacao.u.uTempo, tempoOnda);
      gl.uniform1f(progOndulacao.u.uDt, dt);
      const k = (l) => (2 * Math.PI) / l;
      // As amplitudes viram unidades da simulação: a velocidade vive em
      // células/s, então aceleração em px/s² é dividida pelo tamanho da
      // célula em px (≈ clientHeight·texel).
      const escala = fatorOndulacao / (canvas.clientHeight * texelVel[1] || 1);
      gl.uniform4f(progOndulacao.u.uOnda1, ONDAS[0].amp * escala, k(ONDAS[0].lx), k(ONDAS[0].ly), 0);
      gl.uniform4f(progOndulacao.u.uOnda2, ONDAS[1].amp * escala, k(ONDAS[1].lx), k(ONDAS[1].ly), 0);
      gl.uniform4f(progOndulacao.u.uFases, ONDAS[0].w1, ONDAS[0].w2, ONDAS[1].w1, ONDAS[1].w2);
      passada(progOndulacao, velocidade.escreve);
      velocidade.trocar();
    }

    // 4. Paredes: reflete a velocidade normal nas bordas (não-penetração).
    // Feito ANTES da projeção para que o solver de pressão já enxergue a
    // parede e empurre a tinta de volta no mesmo quadro.
    gl.useProgram(progContorno.p);
    gl.uniform1i(progContorno.u.uVelocidade, ligarTextura(0, velocidade.lê.tex));
    gl.uniform2f(progContorno.u.uTexel, texelVel[0], texelVel[1]);
    passada(progContorno, velocidade.escreve);
    velocidade.trocar();

    // 5. Incompressibilidade: divergência → pressão (Jacobi) → projeção.
    gl.useProgram(progDivergencia.p);
    gl.uniform1i(progDivergencia.u.uVelocidade, ligarTextura(0, velocidade.lê.tex));
    gl.uniform2f(progDivergencia.u.uTexel, texelVel[0], texelVel[1]);
    passada(progDivergencia, divergencia);

    // Amortece a pressão do quadro anterior (bom chute inicial do Jacobi).
    gl.useProgram(progDesbotar.p);
    gl.uniform1i(progDesbotar.u.uAlvo, ligarTextura(0, pressao.lê.tex));
    gl.uniform3f(progDesbotar.u.uCor, 0, 0, 0);
    gl.uniform1f(progDesbotar.u.uFator, 1 - RETENCAO_PRESSAO);
    passada(progDesbotar, pressao.escreve);
    pressao.trocar();

    gl.useProgram(progPressao.p);
    gl.uniform1i(progPressao.u.uDivergencia, ligarTextura(1, divergencia.tex));
    gl.uniform2f(progPressao.u.uTexel, texelVel[0], texelVel[1]);
    for (let i = 0; i < ITERACOES_PRESSAO; i++) {
      gl.uniform1i(progPressao.u.uPressao, ligarTextura(0, pressao.lê.tex));
      passada(progPressao, pressao.escreve);
      pressao.trocar();
    }

    gl.useProgram(progProjecao.p);
    gl.uniform1i(progProjecao.u.uPressao, ligarTextura(0, pressao.lê.tex));
    gl.uniform1i(progProjecao.u.uVelocidade, ligarTextura(1, velocidade.lê.tex));
    gl.uniform2f(progProjecao.u.uTexel, texelVel[0], texelVel[1]);
    passada(progProjecao, velocidade.escreve);
    velocidade.trocar();

    // Reaplica o contorno à velocidade já projetada: a projeção pode
    // reintroduzir um respingo normal na parede, então selamos de novo
    // antes de advectar a tinta — assim o corante nunca é carregado para
    // fora da bacia.
    gl.useProgram(progContorno.p);
    gl.uniform1i(progContorno.u.uVelocidade, ligarTextura(0, velocidade.lê.tex));
    gl.uniform2f(progContorno.u.uTexel, texelVel[0], texelVel[1]);
    passada(progContorno, velocidade.escreve);
    velocidade.trocar();

    // 6. A correnteza carrega a tinta — em duas passadas (MacCormack):
    //    primeiro a advecção simples (φ1), depois a correção do erro, que
    //    devolve a nitidez que a interpolação roubaria.
    gl.useProgram(progAdveccao.p);
    gl.uniform1i(progAdveccao.u.uVelocidade, ligarTextura(0, velocidade.lê.tex));
    gl.uniform1i(progAdveccao.u.uFonte, ligarTextura(1, tinta.lê.tex));
    gl.uniform2f(progAdveccao.u.uTexel, texelVel[0], texelVel[1]);
    gl.uniform1f(progAdveccao.u.uDt, dt);
    gl.uniform1f(progAdveccao.u.uDissipacao, DISSIPACAO_TINTA);
    passada(progAdveccao, tintaIntermedia);

    gl.useProgram(progMacCormack.p);
    gl.uniform1i(progMacCormack.u.uVelocidade, ligarTextura(0, velocidade.lê.tex));
    gl.uniform1i(progMacCormack.u.uFonte, ligarTextura(1, tinta.lê.tex));
    gl.uniform1i(progMacCormack.u.uPrevisto, ligarTextura(2, tintaIntermedia.tex));
    gl.uniform2f(progMacCormack.u.uTexel, texelVel[0], texelVel[1]);
    gl.uniform2f(progMacCormack.u.uTexelFonte, texelTinta[0], texelTinta[1]);
    gl.uniform1f(progMacCormack.u.uDt, dt);
    gl.uniform1f(progMacCormack.u.uNitidez, NITIDEZ_TINTA);
    passada(progMacCormack, tinta.escreve);
    tinta.trocar();
  }

  // -------------------------------------------------------------------------
  // Comandos (coordenadas em px CSS, origem no canto superior esquerdo)
  // -------------------------------------------------------------------------

  function uv(x, y) {
    // WebGL tem o eixo y para cima; a página, para baixo.
    return [x / canvas.clientWidth, 1 - y / canvas.clientHeight];
  }

  /** Raio gaussiano (uniform uRaio = r²) a partir de um raio em px. */
  function raio2(px) {
    const r = px / canvas.clientHeight; // fração da altura (eixo de uProporcao)
    return r * r;
  }

  function splat(alvoDuplo, x, y, valor, raioPx, modo) {
    gl.bindVertexArray(vao);
    gl.useProgram(progSplat.p);
    gl.uniform1i(progSplat.u.uAlvo, ligarTextura(0, alvoDuplo.lê.tex));
    const [u, v] = uv(x, y);
    gl.uniform2f(progSplat.u.uPonto, u, v);
    gl.uniform3f(progSplat.u.uValor, valor[0], valor[1], valor[2]);
    gl.uniform1f(progSplat.u.uRaio, raio2(raioPx));
    gl.uniform1f(progSplat.u.uProporcao, proporcao);
    gl.uniform1f(progSplat.u.uDensidadeMax, DENSIDADE_MAXIMA);
    gl.uniform1i(progSplat.u.uModo, modo);
    passada(progSplat, alvoDuplo.escreve);
    alvoDuplo.trocar();
  }

  /**
   * Pinga uma gota: soma DENSIDADE ao campo de fluido e empurra a água em
   * anel para fora (o empurrão que abre espaço e desloca o que está em
   * volta, como a tensão superficial de uma gota real).
   *
   * Recebe a densidade JÁ CONVERTIDA — quem traduz cor → densidade é o
   * modo (modos.js), porque é aí que mora o "espelho": na água a densidade
   * é absorção (−ln da cor); no cosmos é emissão (a própria luz). O motor
   * não precisa saber qual — só soma densidade e empurra.
   *
   * No cosmos, esta mesma gota é lida como uma NEBULOSA: uma nuvem de gás
   * luminoso. É o splat da água, no espelho.
   *
   * @param {[number,number,number]} densidade - por canal
   */
  function pingar(x, y, raioPx, densidade) {
    splat(tinta, x, y, densidade, raioPx, 1);
    splat(velocidade, x, y, [FORCA_GOTA, 0, 0], raioPx * 1.6, 2);
  }

  /**
   * Pinga uma gota de "água": DILUI o pigmento local (subtrai densidade,
   * nunca abaixo de zero) e dá o mesmo empurrão radial de uma gota de
   * tinta. É o dispersante do suminagashi clássico: alternar tinta e água
   * no mesmo ponto desenha anéis concêntricos.
   */
  function pingarAgua(x, y, raioPx) {
    splat(tinta, x, y, [DILUICAO_AGUA, DILUICAO_AGUA, DILUICAO_AGUA], raioPx, 4);
    splat(velocidade, x, y, [FORCA_GOTA, 0, 0], raioPx * 1.6, 2);
  }

  // -------------------------------------------------------------------------
  // MOTOR COSMOS — pintura de luz (sem solver de Navier-Stokes)
  //
  // A correção do v4: o cosmos NÃO é "a água no espelho". Ele é um pintor de
  // luz por acúmulo. Reusa o MESMO buffer (a textura de densidade) e o mesmo
  // render aditivo, mas as operações abaixo escrevem luz direto no buffer —
  // sem advecção/pressão/vorticidade. A tela fica PARADA (quem chama nem roda
  // o passo da física no cosmos); só muda quando estas funções são chamadas.
  // -------------------------------------------------------------------------

  /** POEIRA — deposita um sopro macio de LUZ (aditivo, baixa intensidade)
   *  no buffer. Passar várias vezes acumula em camadas e clareia. */
  function poeira(x, y, raioPx, densidade) {
    splat(tinta, x, y, densidade, raioPx, 1);
  }

  /** SOPRO — espalha a luz já depositada na direção (mx,my), localmente. */
  function soprar(x, y, mx, my, raioPx, forca) {
    gl.bindVertexArray(vao);
    gl.useProgram(progSopro.p);
    gl.uniform1i(progSopro.u.uAlvo, ligarTextura(0, tinta.lê.tex));
    const [u, v] = uv(x, y);
    gl.uniform2f(progSopro.u.uPonto, u, v);
    // my invertido: eixo y da página aponta para baixo, o da textura p/ cima.
    gl.uniform2f(progSopro.u.uDir, mx, -my);
    gl.uniform1f(progSopro.u.uRaio, raio2(raioPx));
    gl.uniform1f(progSopro.u.uProporcao, proporcao);
    gl.uniform1f(progSopro.u.uForca, forca);
    passada(progSopro, tinta.escreve);
    tinta.trocar();
  }

  /** ASSENTAR — uma difusão levíssima da luz (média dos vizinhos), aplicada
   *  pós-gesto e com fim definido (quem chama decai a quantidade até zero). */
  function assentarLuz(quantidade) {
    gl.bindVertexArray(vao);
    gl.useProgram(progDifuso.p);
    gl.uniform1i(progDifuso.u.uAlvo, ligarTextura(0, tinta.lê.tex));
    gl.uniform2f(progDifuso.u.uTexel, texelTinta[0], texelTinta[1]);
    gl.uniform1f(progDifuso.u.uQtd, quantidade);
    passada(progDifuso, tinta.escreve);
    tinta.trocar();
  }

  /**
   * Estilete: a água sob o dedo ADOTA a velocidade do gesto (modo 3 do
   * splat). A física faz o resto: a correnteza se propaga, ganha momentum,
   * dobra a tinta em espirais — e decai sozinha quando o dedo sai.
   *
   * @param {number} mx,my  - direção unitária do gesto
   * @param {number} velPx  - rapidez do gesto em px/s (do input, suavizada)
   */
  function mexer(x, y, mx, my, velPx, raioPx) {
    // Converte px/s para células/s (a unidade interna da velocidade):
    // tamanho da célula em px = clientHeight / linhas da grade.
    const celulaPx = canvas.clientHeight * texelVel[1] || 1;
    const v = velPx / celulaPx;
    // my invertido: eixo y da página aponta para baixo, o da simulação
    // para cima.
    splat(velocidade, x, y, [mx * v, -my * v, 0], raioPx, 3);
  }

  /** Desbota toda a tinta em direção ao papel (0 = nada, 1 = limpa tudo).
   *  Em densidade, "papel" é simplesmente densidade zero. */
  function desbotar(fator) {
    gl.bindVertexArray(vao);
    gl.useProgram(progDesbotar.p);
    gl.uniform1i(progDesbotar.u.uAlvo, ligarTextura(0, tinta.lê.tex));
    gl.uniform3f(progDesbotar.u.uCor, 0, 0, 0);
    gl.uniform1f(progDesbotar.u.uFator, fator);
    passada(progDesbotar, tinta.escreve);
    tinta.trocar();
  }

  /**
   * Compõe a cena (fluido + estrelas) num alvo (null = tela). É o ponto
   * onde a densidade vira pixel, conforme o modo, e onde a camada de
   * estrelas (cosmos) é desenhada POR CIMA do fluido com blend aditivo.
   */
  function desenharComposicao(alvo, tempo, cintila) {
    // 1. O fluido (água: absorção; cosmos: emissão).
    gl.bindVertexArray(vao);
    gl.useProgram(progExibir.p);
    gl.uniform1i(progExibir.u.uTinta, ligarTextura(0, tinta.lê.tex));
    gl.uniform3f(progExibir.u.uFundo, fundo[0], fundo[1], fundo[2]);
    gl.uniform1i(progExibir.u.uModo, modoRender);
    gl.uniform1f(progExibir.u.uBrilho, brilhoCosmos);
    passada(progExibir, alvo);

    // 2. As estrelas (só no cosmos): pontos fixos, somando luz por cima.
    if (modoRender === 1 && numEstrelas > 0) {
      const w = alvo ? alvo.w : canvas.width;
      const h = alvo ? alvo.h : canvas.height;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE); // aditivo: soma luz
      gl.useProgram(progEstrela.p);
      gl.bindVertexArray(vaoEstrela);
      gl.uniform1f(progEstrela.u.uAltura, h);
      gl.uniform1f(progEstrela.u.uTempo, tempo || 0);
      gl.uniform1f(progEstrela.u.uCintila, cintila ? 1 : 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, alvo ? alvo.fbo : null);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.POINTS, 0, numEstrelas);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(vao);
    }
  }

  /** Desenha a cena na tela. tempo (s) e cintila controlam as estrelas. */
  function exibir(tempo, cintila) {
    desenharComposicao(null, tempo, cintila);
  }

  /** Define a cor base atrás do fluido (papel washi ou vazio do cosmos).
   *  A obra não muda: a densidade independe do fundo. */
  function definirFundo(rgb) {
    fundo = [rgb[0], rgb[1], rgb[2]];
  }

  /** Seleciona o caminho de render: 0 = água (subtrativo), 1 = cosmos. */
  function definirModo(m) {
    modoRender = m;
  }

  /** Ganho de emissão do cosmos (dia ↔ noite). Sem efeito na água. */
  function definirBrilho(b) {
    brilhoCosmos = b;
  }

  /**
   * Carrega a lista de estrelas na GPU. Cada estrela:
   * { xn, yn (0..1, origem topo-esq), tam (fração da altura), cor [r,g,b],
   *   brilho, fase }. Reenviar só quando a lista muda (não por quadro).
   */
  function definirEstrelas(lista) {
    numEstrelas = lista.length;
    if (numEstrelas === 0) return;
    const buf = new Float32Array(numEstrelas * STRIDE_ESTRELA);
    for (let i = 0; i < numEstrelas; i++) {
      const e = lista[i];
      const o = i * STRIDE_ESTRELA;
      buf[o] = e.xn * 2 - 1; // clip x
      buf[o + 1] = 1 - e.yn * 2; // clip y (eixo invertido)
      buf[o + 2] = e.tam;
      buf[o + 3] = e.cor[0];
      buf[o + 4] = e.cor[1];
      buf[o + 5] = e.cor[2];
      buf[o + 6] = e.brilho;
      buf[o + 7] = e.fase;
    }
    gl.bindVertexArray(vaoEstrela);
    gl.bindBuffer(gl.ARRAY_BUFFER, vboEstrela);
    gl.bufferData(gl.ARRAY_BUFFER, buf, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(vao);
  }

  /** Ajusta o ritmo da respiração ambiente (1 = padrão; <1 mais lenta). */
  function definirRitmo(fator) {
    ritmoOndulacao = fator;
  }

  /**
   * Captura a obra renderizada (cores finais, já com papel e Beer-Lambert)
   * num bitmap pequeno — usado pelo ritual para extrair o tema e gerar a
   * miniatura. Retorna { pixels: Uint8Array RGBA, w, h }; linhas na ordem
   * do WebGL (de baixo para cima — quem desenhar em canvas 2D deve
   * inverter o eixo y).
   */
  function capturar(largura, tempo, cintila) {
    const w = Math.max(1, Math.round(largura));
    const h = Math.max(1, Math.round(w / proporcao));
    const alvo = criarAlvo(w, h, gl.RGBA8, gl.RGBA, gl.LINEAR, gl.UNSIGNED_BYTE);

    // Mesma composição da tela (fluido + estrelas), só que num alvo grande.
    desenharComposicao(alvo, tempo, cintila);

    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // Alvo descartável: liberar agora evita acumular texturas órfãs.
    gl.deleteFramebuffer(alvo.fbo);
    gl.deleteTexture(alvo.tex);
    return { pixels, w, h };
  }

  /** Dimensões reais [w, h] da grade de tinta — o teto de detalhe que uma
   *  captura pode ter (capturar acima disso só interpola, não cria nitidez). */
  function dimensoesTinta() {
    return [dimsTinta[0], dimsTinta[1]];
  }

  redimensionar();
  return {
    redimensionar,
    passo,
    pingar,
    pingarAgua,
    mexer,
    poeira,
    soprar,
    assentarLuz,
    desbotar,
    exibir,
    definirFundo,
    definirModo,
    definirBrilho,
    definirEstrelas,
    definirRitmo,
    capturar,
    dimensoesTinta,
  };
}
