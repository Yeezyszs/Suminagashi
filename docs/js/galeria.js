// galeria.js — O Templo: a galeria 3D (Three.js vendorado localmente).
//
// MUDANÇA DE NATUREZA (consciente): este é o único lugar do projeto que usa
// uma dependência (Three.js). Ela é VENDORADA em js/vendor/three.module.js e
// resolvida por import map — o site continua abrindo offline, com a versão
// congelada no repo. O ateliê (a água) segue vanilla e intocado: pintar é
// vanilla, expor é 3D.
//
// DIREÇÃO DE ARTE acima de tudo: em 3D, o bonito vem da LUZ e do MATERIAL,
// não do código. A assinatura é a luz entrando pelos shoji (paredes de
// papel) e correndo pela madeira. Tudo o mais fica quieto a serviço disso:
// luz suave (direcional fazendo o sol + ambiente baixo e quente), sombras
// macias, materiais foscos e críveis, e vazio (ma 間) generoso.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Constantes de calibração (ajustar no tato, com screenshots)
// ---------------------------------------------------------------------------

// Dimensões do cômodo (metros). Proporção de tatami: baixo, largo, íntimo.
const LARGURA = 6.0; // X (esquerda↔direita)
const PROFUND = 5.0; // Z (frente↔fundo)
const ALTURA = 2.6; // Y (chão↔teto)

// Materiais (tokens do brief).
const COR_MADEIRA = 0xc9a66b; // hinoki claro
const COR_MADEIRA_ESC = 0x7a5c3a; // vigas, molduras
const COR_TATAMI = 0xc7be94; // palha fosca
const COR_SHOJI = 0xf2ecdd; // papel translúcido (a luz passa por aqui)
const COR_PAREDE = 0xe8e2d2; // reboco claro
const COR_SHU = 0xb5402e; // vermelhão — só o selo (Fase 4)

// Luz (Fase 1: dia neutro-quente; o ciclo por hora vem na Fase 3).
const LUZ_COR = 0xfff1da; // sol quente-suave
const LUZ_INTENSIDADE = 2.1;
const AMBIENTE_COR = 0xf0e8d6;
const AMBIENTE_INTENSIDADE = 1.05; // preenchimento alto: nada de cantos pretos
const FOG_COR = 0xcdbfa6;
const FOG_DENSIDADE = 0.035;

const DPR_MAXIMO = 2;

// ---------------------------------------------------------------------------
// Texturas procedurais (canvas → CanvasTexture). Nada baixado em runtime.
// ---------------------------------------------------------------------------

/** Pequeno ruído determinístico p/ variação de tom (sem Math.random no loop). */
function ruido(x, y) {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

/** Tatami: palha trançada fosca, com a borda escura característica das
 *  esteiras. Repetida no chão forma a grade de tatames. */
function texturaTatami() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c7be94';
  g.fillRect(0, 0, 256, 256);
  // trama: fios finos numa direção (a palha corre num sentido)
  for (let y = 0; y < 256; y += 2) {
    const t = 0.5 + 0.5 * Math.sin(y * 0.6);
    g.strokeStyle = `rgba(150,140,98,${0.08 + 0.06 * t})`;
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(256, y + 0.5);
    g.stroke();
  }
  // leve variação de manchas
  for (let i = 0; i < 400; i++) {
    const rx = ruido(i, 1) * 256;
    const ry = ruido(i, 2) * 256;
    g.fillStyle = `rgba(120,110,75,${0.03 + 0.04 * ruido(i, 3)})`;
    g.fillRect(rx, ry, 2, 2);
  }
  // borda da esteira (faixa de tecido) — fina e discreta, não pesada
  g.strokeStyle = 'rgba(60,54,40,0.55)';
  g.lineWidth = 2.5;
  g.strokeRect(1.5, 1.5, 253, 253);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Madeira: veios horizontais com variação de tom; fosca, nada plástica. */
function texturaMadeira(claraHex) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = claraHex;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const y = ruido(i, 7) * 256;
    const esc = 0.06 + 0.16 * ruido(i, 9);
    g.strokeStyle = `rgba(90,66,38,${esc})`;
    g.lineWidth = 0.5 + ruido(i, 11) * 2;
    g.beginPath();
    g.moveTo(0, y);
    // veio levemente ondulado
    for (let xx = 0; xx <= 256; xx += 16) g.lineTo(xx, y + Math.sin(xx * 0.05 + i) * 1.5);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Papel shoji: off-white quente com fibras finíssimas. Brilha de leve
 *  (emissivo) porque a luz do lado de fora o atravessa. */
function texturaShoji() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f2ecdd';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 200; i++) {
    const x = ruido(i, 5) * 256;
    const y = ruido(i, 6) * 256;
    const l = 4 + ruido(i, 8) * 14;
    g.strokeStyle = `rgba(210,200,178,${0.15 * ruido(i, 4)})`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + l, y + (ruido(i, 10) - 0.5) * 3);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Construção do cômodo
// ---------------------------------------------------------------------------

function criarCena(renderer) {
  const cena = new THREE.Scene();
  cena.background = new THREE.Color(FOG_COR);
  cena.fog = new THREE.FogExp2(FOG_COR, FOG_DENSIDADE);

  // --- materiais (reusados; foscos, não-metálicos) -----------------------
  const matTatami = new THREE.MeshStandardMaterial({
    map: texturaTatami(),
    roughness: 0.95,
    metalness: 0,
  });
  matTatami.map.repeat.set(LARGURA / 1.8, PROFUND / 1.8); // esteiras calmas, ~1.8m

  const matMadeira = new THREE.MeshStandardMaterial({
    map: texturaMadeira('#c9a66b'),
    roughness: 0.8,
    metalness: 0,
  });
  const matMadeiraEsc = new THREE.MeshStandardMaterial({
    map: texturaMadeira('#7a5c3a'),
    color: 0x9b7a4f,
    roughness: 0.75,
    metalness: 0,
  });
  // Teto: ripado de madeira CLARA (sukiya) — não pode virar void no topo.
  const matTeto = new THREE.MeshStandardMaterial({
    map: texturaMadeira('#dccba6'),
    color: 0xd9cdac,
    roughness: 0.9,
    metalness: 0,
  });
  matTeto.map.repeat.set(7, 1);
  matTeto.map.wrapS = matTeto.map.wrapT = THREE.RepeatWrapping;
  const matParede = new THREE.MeshStandardMaterial({ color: COR_PAREDE, roughness: 1, metalness: 0 });
  const matShoji = new THREE.MeshStandardMaterial({
    map: texturaShoji(),
    emissive: new THREE.Color(0xfff4e0),
    emissiveIntensity: 0.72, // brilha como papel iluminado por trás
    roughness: 1,
    metalness: 0,
  });

  // --- chão (tatami) ------------------------------------------------------
  const chao = new THREE.Mesh(new THREE.PlaneGeometry(LARGURA, PROFUND), matTatami);
  chao.rotation.x = -Math.PI / 2;
  chao.receiveShadow = true;
  cena.add(chao);

  // --- teto (ripado de madeira clara) ------------------------------------
  const teto = new THREE.Mesh(new THREE.PlaneGeometry(LARGURA, PROFUND), matTeto);
  teto.rotation.x = Math.PI / 2;
  teto.position.y = ALTURA;
  cena.add(teto);

  // --- paredes ------------------------------------------------------------
  // Direita (+X): reboco claro.
  const direita = new THREE.Mesh(new THREE.PlaneGeometry(PROFUND, ALTURA), matParede);
  direita.rotation.y = -Math.PI / 2;
  direita.position.set(LARGURA / 2, ALTURA / 2, 0);
  direita.receiveShadow = true;
  cena.add(direita);

  // Esquerda (-X): SHOJI — a parede de papel por onde o sol entra.
  cena.add(criarParedeShoji(matShoji, matMadeira));

  // --- vigas (estrutura): rodapé/rodateto de madeira ---------------------
  cena.add(criarVigas(matMadeira));

  // --- tokonoma (nicho de honra) -----------------------------------------
  cena.add(criarTokonoma(matMadeira, matMadeiraEsc, matParede));

  return cena;
}

/** Parede shoji: painel de papel brilhante + treliça de madeira (mortantes)
 *  por cima — são as ripas que projetam a sombra reticulada no tatami. */
function criarParedeShoji(matShoji, matMadeira) {
  const grupo = new THREE.Group();
  grupo.position.set(-LARGURA / 2, 0, 0);
  grupo.rotation.y = Math.PI / 2;

  // painel de papel (emissivo)
  const papel = new THREE.Mesh(new THREE.PlaneGeometry(PROFUND, ALTURA), matShoji);
  papel.position.set(0, ALTURA / 2, 0);
  grupo.add(papel);

  // treliça: ripas finas que CASTAM sombra (a assinatura).
  const espVert = PROFUND / 6;
  const espHoriz = ALTURA / 4;
  const ripa = 0.03;
  for (let i = 1; i < 6; i++) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(ripa, ALTURA, ripa), matMadeira);
    v.position.set(-PROFUND / 2 + i * espVert, ALTURA / 2, 0.02);
    v.castShadow = true;
    grupo.add(v);
  }
  for (let j = 1; j < 4; j++) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(PROFUND, ripa, ripa), matMadeira);
    h.position.set(0, j * espHoriz, 0.02);
    h.castShadow = true;
    grupo.add(h);
  }
  // moldura da parede shoji
  const molduraGeo = new THREE.BoxGeometry(PROFUND, 0.08, 0.08);
  const topo = new THREE.Mesh(molduraGeo, matMadeira);
  topo.position.set(0, ALTURA - 0.04, 0.02);
  topo.castShadow = true;
  grupo.add(topo);
  return grupo;
}

/** Vigas de madeira no encontro parede/teto (nageshi) — dão linha e escala. */
function criarVigas(matMadeira) {
  const grupo = new THREE.Group();
  const h = 0.12;
  const y = ALTURA - 0.5; // viga corrida abaixo do teto
  const fazer = (w, x, z, ry) => {
    const v = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), matMadeira);
    v.position.set(x, y, z);
    v.rotation.y = ry;
    v.castShadow = true;
    grupo.add(v);
  };
  fazer(LARGURA, 0, -PROFUND / 2 + 0.03, 0); // fundo
  fazer(PROFUND, LARGURA / 2 - 0.03, 0, -Math.PI / 2); // direita
  return grupo;
}

/** Tokonoma: o nicho de honra na parede do fundo. Plataforma de madeira
 *  elevada, painel ao fundo levemente recuado, o toko-bashira (pilar
 *  característico) de um lado e a viga rebaixada (otoshigake) por cima. O
 *  vazio do nicho É o protagonista (à la bonsai sozinho). */
function criarTokonoma(matMadeira, matMadeiraEsc, matParede) {
  const grupo = new THREE.Group();
  const lar = 1.6; // largura do nicho
  const prof = 0.55; // profundidade do RECUO (é isto que dá o nicho)
  const cx = 0.45; // deslocado do centro (assimetria japonesa)
  const zParede = -PROFUND / 2; // plano da parede do fundo
  const zNicho = zParede - prof; // o fundo recuado da alcova
  const aAb = ALTURA - 0.5; // altura da abertura (até a viga otoshigake)
  const xE = cx - lar / 2; // borda esquerda da abertura
  const xD = cx + lar / 2; // borda direita

  // helper: plano vertical de parede (normal +Z por padrão)
  const parede = (w, h, x, y, z, ry, mat) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    return m;
  };

  // --- parede do fundo, RECORTADA ao redor da abertura do nicho ----------
  const larEsq = xE + LARGURA / 2; // painel à esquerda da abertura
  grupo.add(parede(larEsq, ALTURA, -LARGURA / 2 + larEsq / 2, ALTURA / 2, zParede, 0, matParede));
  const larDir = LARGURA / 2 - xD; // painel à direita
  grupo.add(parede(larDir, ALTURA, xD + larDir / 2, ALTURA / 2, zParede, 0, matParede));
  // painel acima da abertura (até o teto)
  grupo.add(parede(lar, ALTURA - aAb, cx, aAb + (ALTURA - aAb) / 2, zParede, 0, matParede));

  // --- interior da alcova (recuada) --------------------------------------
  const matNicho = matParede.clone();
  matNicho.color = new THREE.Color(0xd8ccb4); // um tom mais quente lá dentro
  // fundo recuado
  grupo.add(parede(lar, aAb, cx, aAb / 2, zNicho + 0.01, 0, matNicho));
  // laterais da alcova (ligam a abertura ao fundo recuado)
  grupo.add(parede(prof, aAb, xE + 0.005, aAb / 2, zParede - prof / 2, Math.PI / 2, matNicho));
  grupo.add(parede(prof, aAb, xD - 0.005, aAb / 2, zParede - prof / 2, -Math.PI / 2, matNicho));
  // teto da alcova (sob a viga)
  const tetoNicho = new THREE.Mesh(new THREE.PlaneGeometry(lar, prof), matMadeira);
  tetoNicho.rotation.x = Math.PI / 2;
  tetoNicho.position.set(cx, aAb - 0.005, zParede - prof / 2);
  grupo.add(tetoNicho);

  // plataforma elevada (toko) de madeira, no piso da alcova
  const plat = new THREE.Mesh(new THREE.BoxGeometry(lar, 0.1, prof), matMadeira);
  plat.position.set(cx, 0.05, zParede - prof / 2);
  plat.castShadow = true;
  plat.receiveShadow = true;
  grupo.add(plat);

  // toko-bashira: o pilar característico na borda da abertura, do chão até
  // a viga. Fica À FRENTE do plano da parede (z + 0.06) — se ficasse NO
  // plano, atravessava a parede e brigava por pixel (z-fighting no batente).
  const pilar = new THREE.Mesh(new THREE.BoxGeometry(0.1, aAb, 0.1), matMadeiraEsc);
  pilar.position.set(xE, aAb / 2, zParede + 0.06);
  pilar.castShadow = true;
  grupo.add(pilar);

  // otoshigake: a viga rebaixada que coroa a abertura — também à frente da
  // parede e do painel de cima, para não brigar com eles.
  const viga = new THREE.Mesh(new THREE.BoxGeometry(lar + 0.22, 0.16, 0.12), matMadeiraEsc);
  viga.position.set(cx, aAb + 0.01, zParede + 0.07);
  viga.castShadow = true;
  grupo.add(viga);

  return grupo;
}

// ---------------------------------------------------------------------------
// Luz (a alma do espaço)
// ---------------------------------------------------------------------------

function criarLuz(cena) {
  // Sol: luz direcional vinda de FORA do shoji (esquerda, alto), entrando
  // em ângulo e correndo pelo tatami. Sombras longas e MACIAS.
  const sol = new THREE.DirectionalLight(LUZ_COR, LUZ_INTENSIDADE);
  sol.position.set(-7, 6, 3); // atrás/acima do shoji esquerdo
  sol.target.position.set(1.5, 0, -1);
  sol.castShadow = true;
  sol.shadow.mapSize.set(2048, 2048);
  sol.shadow.radius = 6; // penumbra (PCFSoft)
  sol.shadow.bias = -0.0006;
  const s = 7;
  sol.shadow.camera.left = -s;
  sol.shadow.camera.right = s;
  sol.shadow.camera.top = s;
  sol.shadow.camera.bottom = -s;
  sol.shadow.camera.near = 0.5;
  sol.shadow.camera.far = 24;
  cena.add(sol);
  cena.add(sol.target);

  // Ambiente: hemisférica baixa e quente preenchendo as sombras (sem
  // estourar). Céu quente, chão da palha refletindo de volta.
  const ceu = new THREE.HemisphereLight(AMBIENTE_COR, COR_TATAMI, AMBIENTE_INTENSIDADE);
  cena.add(ceu);

  return { sol, ceu };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Cria a galeria 3D dentro de um <canvas>. Retorna { render, redimensionar,
 * dispose, camera, cena, luz } — Fase 1 só precisa render/redimensionar.
 */
export function criarGaleria(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_MAXIMO));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const cena = criarCena(renderer);
  const luz = criarLuz(cena);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 100);
  // Olho humano perto da entrada, olhando para o tokonoma (fundo).
  camera.position.set(1.6, 1.45, 1.8);
  camera.lookAt(-0.8, 1.1, -PROFUND / 2);

  function redimensionar() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }

  function render() {
    renderer.render(cena, camera);
  }

  function dispose() {
    renderer.dispose();
  }

  redimensionar();
  return { render, redimensionar, dispose, camera, cena, luz, renderer };
}

// ---------------------------------------------------------------------------
// Navegação em primeira pessoa (contemplativa, à prova de enjoo)
//
// Dois gestos só, iguais no mouse e no toque:
//   - ARRASTAR  → olhar ao redor (gira yaw/pitch; pitch limitado, sem rolar)
//   - TOCAR/CLICAR (sem arrastar) → caminhar suavemente ATÉ aquele ponto
//     (raycast no chão/parede/obra). Clicar numa obra = aproximar-se dela.
// Não há WASD nem corrida: é uma "caminhada assistida", mais quieta e sem
// balanço de câmera (a metáfora do templo pede contemplação, não FPS).
// ---------------------------------------------------------------------------

const ALTURA_OLHO = 1.5; // altura dos olhos (m)
const SENS_OLHAR = 0.0010; // rad por pixel arrastado
const PITCH_LIMITE = 0.5; // ~28°: não dá para olhar o teto/chão por inteiro
const LIMIAR_ARRASTE = 6; // px: abaixo disso, é um toque (caminhar)
const VEL_CAMINHAR = 2.2; // suavização do deslocamento (maior = mais rápido)
const DIST_PARADA = 1.9; // para a esta distância do ponto clicado (m)
const MARGEM_PAREDE = 0.8; // não encosta nas paredes

/**
 * Instala a navegação num canvas sobre uma galeria. Retorna { atualizar(dt) }
 * — chamar uma vez por quadro antes de render.
 */
export function instalarNavegacao(canvas, galeria, reduzMovimento) {
  const { camera } = galeria;

  // Estado: yaw=0 olha para o fundo (−Z, o tokonoma); pitch levemente baixo.
  let yaw = 0;
  let pitch = -0.04;
  const pos = new THREE.Vector3(camera.position.x, ALTURA_OLHO, camera.position.z);
  const alvo = pos.clone(); // destino da caminhada
  const raycaster = new THREE.Raycaster();
  const dir = new THREE.Vector3();

  let ponteiro = null;
  let ultimoX = 0;
  let ultimoY = 0;
  let andouX = 0;
  let andouY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    if (ponteiro !== null) return;
    ponteiro = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    ultimoX = e.clientX;
    ultimoY = e.clientY;
    andouX = andouY = 0;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== ponteiro) return;
    const dx = e.clientX - ultimoX;
    const dy = e.clientY - ultimoY;
    ultimoX = e.clientX;
    ultimoY = e.clientY;
    andouX += Math.abs(dx);
    andouY += Math.abs(dy);
    // Arrastar gira a vista (resposta imediata, sem suavização — natural).
    yaw -= dx * SENS_OLHAR;
    pitch = Math.max(-PITCH_LIMITE, Math.min(PITCH_LIMITE, pitch + dy * SENS_OLHAR));
  });

  function terminar(e) {
    if (e.pointerId !== ponteiro) return;
    // Foi um TOQUE (quase sem mover) → caminhar até o ponto apontado.
    if (andouX + andouY < LIMIAR_ARRASTE) caminharPara(e);
    ponteiro = null;
  }
  canvas.addEventListener('pointerup', terminar);
  canvas.addEventListener('pointercancel', terminar);

  /** Raycast do ponto clicado para a cena; define o destino da caminhada. */
  function caminharPara(e) {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(galeria.cena.children, true);
    if (!hits.length) return;
    const p = hits[0].point;

    // Direção horizontal câmera→ponto; paramos DIST_PARADA antes do alvo
    // (assim clicar numa parede/obra aproxima sem atravessar).
    const d = new THREE.Vector3(p.x - pos.x, 0, p.z - pos.z);
    const dist = d.length();
    if (dist > 0.001) d.divideScalar(dist);
    const avanco = Math.max(0, dist - DIST_PARADA);
    const destino = new THREE.Vector3(pos.x + d.x * avanco, ALTURA_OLHO, pos.z + d.z * avanco);
    // Mantém dentro da sala.
    destino.x = Math.max(-LARGURA / 2 + MARGEM_PAREDE, Math.min(LARGURA / 2 - MARGEM_PAREDE, destino.x));
    destino.z = Math.max(-PROFUND / 2 + MARGEM_PAREDE, Math.min(PROFUND / 2 - MARGEM_PAREDE, destino.z));
    alvo.copy(destino);
  }

  function atualizar(dt) {
    // Caminhada suave (ou imediata sob prefers-reduced-motion).
    const k = reduzMovimento ? 1 : Math.min(1, dt * VEL_CAMINHAR);
    pos.lerp(alvo, k);
    camera.position.copy(pos);
    // Aplica yaw/pitch (sem roll).
    dir.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    );
    camera.lookAt(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z);
  }

  return { atualizar };
}
