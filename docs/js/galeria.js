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

/** Desenha uma esteira de tatami numa região do canvas: palha trançada numa
 *  direção (horizontal OU vertical, alternada entre esteiras vizinhas, como
 *  no assentamento real) + a borda de tecido (heri) que a contorna. */
function desenharEsteira(g, x, y, w, h, vertical, semente) {
  // base de palha com leve variação de tom por esteira (envelhecimento)
  const tom = 0.94 + 0.06 * ruido(semente, 21);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = `rgb(${Math.round(199 * tom)},${Math.round(190 * tom)},${Math.round(148 * tom)})`;
  g.fillRect(x, y, w, h);
  // trama: fios finos paralelos (igusa). A direção alterna por esteira.
  const passo = 3;
  if (vertical) {
    for (let xx = x; xx < x + w; xx += passo) {
      const t = 0.5 + 0.5 * Math.sin(xx * 0.6);
      g.strokeStyle = `rgba(150,140,98,${0.10 + 0.07 * t})`;
      g.beginPath(); g.moveTo(xx + 0.5, y); g.lineTo(xx + 0.5, y + h); g.stroke();
    }
  } else {
    for (let yy = y; yy < y + h; yy += passo) {
      const t = 0.5 + 0.5 * Math.sin(yy * 0.6);
      g.strokeStyle = `rgba(150,140,98,${0.10 + 0.07 * t})`;
      g.beginPath(); g.moveTo(x, yy + 0.5); g.lineTo(x + w, yy + 0.5); g.stroke();
    }
  }
  // manchas suaves de uso
  for (let i = 0; i < 90; i++) {
    const rx = x + ruido(i + semente, 1) * w;
    const ry = y + ruido(i + semente, 2) * h;
    g.fillStyle = `rgba(120,110,75,${0.03 + 0.04 * ruido(i + semente, 3)})`;
    g.fillRect(rx, ry, 2, 2);
  }
  g.restore();
  // heri: a faixa de tecido escuro que emoldura a esteira (fina, discreta).
  g.strokeStyle = 'rgba(58,52,38,0.6)';
  g.lineWidth = 4;
  g.strokeRect(x + 2, y + 2, w - 4, h - 4);
}

/** Tatami da SALA inteira: várias esteiras 2:1 lado a lado, com a trama
 *  alternando 90° entre vizinhas (o xadrez característico) e o heri de cada
 *  uma. Mapeada 1:1 no chão (sem repetição), então o assentamento é real,
 *  não um ladrilho repetido. */
function texturaTatami(cols, linhas) {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 1000;
  const g = c.getContext('2d');
  g.fillStyle = '#bcb389';
  g.fillRect(0, 0, c.width, c.height);
  const cw = c.width / cols;
  const ch = c.height / linhas;
  for (let r = 0; r < linhas; r++) {
    for (let col = 0; col < cols; col++) {
      // a trama alterna em xadrez (esteiras vizinhas a 90°)
      desenharEsteira(g, col * cw, r * ch, cw, ch, (col + r) % 2 === 0, col * 7 + r * 13 + 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8; // a trama em ângulo raso não vira borrão
  return tex;
}

/** Parede de reboco (terra/argila): off-white quente com um mosqueado fino e
 *  irregular, para não ser um chapado liso digital. */
function texturaParede() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e6e0cf';
  g.fillRect(0, 0, 256, 256);
  // mosqueado de argila: manchas claras e escuras muito sutis
  for (let i = 0; i < 1400; i++) {
    const x = ruido(i, 31) * 256;
    const y = ruido(i, 32) * 256;
    const d = ruido(i, 33);
    const claro = d > 0.5;
    const a = 0.04 + 0.05 * ruido(i, 34);
    g.fillStyle = claro ? `rgba(255,250,238,${a})` : `rgba(150,138,112,${a})`;
    g.fillRect(x, y, 1 + ruido(i, 35) * 2, 1 + ruido(i, 36) * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Madeira: veios horizontais orgânicos com variação de tom, alguns nós e um
 *  leve desgaste — fosca, nada plástica. */
function texturaMadeira(claraHex) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = claraHex;
  g.fillRect(0, 0, 256, 256);
  // manchas largas de tom (a madeira não é de cor uniforme)
  for (let i = 0; i < 24; i++) {
    const y = ruido(i, 41) * 256;
    g.fillStyle = `rgba(90,66,38,${0.03 + 0.04 * ruido(i, 42)})`;
    g.fillRect(0, y, 256, 8 + ruido(i, 43) * 40);
  }
  // veios: linhas onduladas, densidade e fase variadas
  for (let i = 0; i < 90; i++) {
    const y = ruido(i, 7) * 256;
    const esc = 0.05 + 0.16 * ruido(i, 9);
    g.strokeStyle = `rgba(86,62,34,${esc})`;
    g.lineWidth = 0.4 + ruido(i, 11) * 1.8;
    const amp = 1 + ruido(i, 12) * 3;
    g.beginPath();
    g.moveTo(0, y);
    for (let xx = 0; xx <= 256; xx += 12) g.lineTo(xx, y + Math.sin(xx * 0.05 + i) * amp);
    g.stroke();
  }
  // alguns nós (olhos da madeira): elipses concêntricas discretas
  for (let k = 0; k < 3; k++) {
    const nx = ruido(k, 51) * 256;
    const ny = ruido(k, 52) * 256;
    for (let r = 1; r < 5; r++) {
      g.strokeStyle = `rgba(70,48,26,${0.16 - r * 0.02})`;
      g.lineWidth = 0.8;
      g.beginPath();
      g.ellipse(nx, ny, r * 2.2, r * 3.4, 0, 0, Math.PI * 2);
      g.stroke();
    }
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
  // Tatami da sala: 3×5 esteiras de 2,0×1,0 m (proporção real 2:1), trama
  // alternada e heri — mapeado 1:1 (sem repetição de ladrilho).
  const matTatami = new THREE.MeshStandardMaterial({
    map: texturaTatami(3, 5),
    roughness: 0.96,
    metalness: 0,
  });

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
  const matParede = new THREE.MeshStandardMaterial({ map: texturaParede(), roughness: 1, metalness: 0 });
  matParede.map.repeat.set(3, 1.5); // o mosqueado de argila repete fino na parede
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
  // ...vestido: um arranjo (vaso + galho) na plataforma, sob o pergaminho.
  const arranjo = criarArranjoTokonoma();
  arranjo.position.set(-0.05, 0.1, -2.7);
  cena.add(arranjo);

  // Devolve a cena + os materiais que a Fase 4 reusa (shoji p/ a luz por
  // hora; madeiras p/ as molduras dos kakemono).
  return { cena, matShoji, matMadeira, matMadeiraEsc };
}

// ---------------------------------------------------------------------------
// Fase 4 — as obras como kakemono (pergaminhos pendurados)
// ---------------------------------------------------------------------------

// Onde as obras ficam: a fundação no nicho de honra (元), as demais nas
// paredes de reboco (NUNCA no shoji — ele é a janela de luz), com vazio (ma)
// generoso entre elas. Capacidade ~6 por cômodo (a Fase 5 ramifica em
// novos cômodos quando enche).
const SLOT_NICHO = { pos: [0.45, 1.2, -PROFUND / 2 - 0.5], ry: 0 };
const SLOTS_PAREDE = [
  { pos: [LARGURA / 2 - 0.04, 1.5, -1.0], ry: -Math.PI / 2 }, // parede direita
  { pos: [LARGURA / 2 - 0.04, 1.5, 0.6], ry: -Math.PI / 2 },
  { pos: [LARGURA / 2 - 0.04, 1.5, 2.0], ry: -Math.PI / 2 },
  { pos: [-1.7, 1.5, -PROFUND / 2 + 0.04], ry: 0 }, // fundo, à esquerda do nicho
  { pos: [2.2, 1.5, -PROFUND / 2 + 0.04], ry: 0 }, // fundo, à direita do nicho
];

const FOCO_DIST = 2.4; // a esta distância (e olhando p/ ela) a obra "foca"

/** Carrega um dataURL como textura (assíncrono). */
function carregarTextura(dataUrl) {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      dataUrl,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        resolve(t);
      },
      undefined,
      () => resolve(null)
    );
  });
}

/** Monta um kakemono: a obra (proporção da imagem) numa moldura escura, com
 *  as hastes de madeira em cima e embaixo, como um pergaminho pendurado. A
 *  obra é levemente emissiva — legível de dia e à noite, como um quadro
 *  iluminado. */
function criarKakemono(textura, matMadeira, matMadeiraEsc, destaque) {
  const grupo = new THREE.Group();
  const aspecto = textura.image ? textura.image.width / textura.image.height : 1.6;
  const w = destaque ? 0.86 : 0.72; // a fundação um pouco maior
  const h = w / aspecto;

  // moldura/fundo de madeira escura
  const moldura = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.07, h + 0.07), matMadeiraEsc);
  grupo.add(moldura);

  // a obra
  const matObra = new THREE.MeshStandardMaterial({
    map: textura,
    emissive: 0xffffff,
    emissiveMap: textura,
    emissiveIntensity: 0.35,
    roughness: 0.95,
    metalness: 0,
  });
  const obra = new THREE.Mesh(new THREE.PlaneGeometry(w, h), matObra);
  obra.position.z = 0.012;
  grupo.add(obra);

  // hastes (rolos) de madeira clara em cima e embaixo
  const haste = new THREE.CylinderGeometry(0.018, 0.018, w + 0.14, 8);
  for (const dy of [h / 2 + 0.05, -h / 2 - 0.05]) {
    const r = new THREE.Mesh(haste, matMadeira);
    r.rotation.z = Math.PI / 2;
    r.position.set(0, dy, 0.012);
    r.castShadow = true;
    grupo.add(r);
  }
  // Guarda o tamanho da OBRA (sem moldura) — o foco usa a altura para
  // calcular a que distância a câmera a enquadra na tela.
  grupo.userData.tamanho = { w, h };
  return grupo;
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

/**
 * Arranjo do tokonoma: um vaso de cerâmica escura com um galho (ikebana
 * mínima, à moda do inverno — pouca folha, muito vazio). Fica na plataforma
 * do nicho, ao lado e abaixo do pergaminho da fundação.
 *
 * PREPARAÇÃO (feature futura): este é um arranjo-PADRÃO provisório. A ideia é
 * que o usuário possa, mais adiante, "cultivar" o próprio bonsai/ikebana —
 * então isto é uma VAGA DE HONRA já montada (vaso + suporte), com um galho
 * genérico que será trocado pelo arranjo do usuário. Nada aqui é definitivo.
 */
function criarArranjoTokonoma() {
  const grupo = new THREE.Group();

  // Vaso: cerâmica escura fosca, ligeiramente cônica.
  const matCeramica = new THREE.MeshStandardMaterial({ color: 0x3c3a3b, roughness: 0.6, metalness: 0 });
  const vaso = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 0.28, 18), matCeramica);
  vaso.position.y = 0.14;
  vaso.castShadow = true;
  vaso.receiveShadow = true;
  grupo.add(vaso);

  // Galhos: cilindros finos orientados de A→B (madeira escura).
  const matGalho = new THREE.MeshStandardMaterial({ color: 0x4b3a2a, roughness: 0.9, metalness: 0 });
  const galho = (ax, ay, az, bx, by, bz, r) => {
    const a = new THREE.Vector3(ax, ay, az);
    const b = new THREE.Vector3(bx, by, bz);
    const comp = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, comp, 6), matGalho);
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = true;
    grupo.add(m);
  };
  galho(0, 0.27, 0, -0.14, 0.64, -0.04, 0.012); // tronco subindo e pendendo à esquerda
  galho(-0.07, 0.46, -0.02, 0.05, 0.68, 0.05, 0.008); // ramo secundário à direita

  // Poucas folhas: planos verdes pequenos (o toque de natureza).
  const matFolha = new THREE.MeshStandardMaterial({
    color: 0x5f7048, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
  });
  const folha = (x, y, z, s, ry) => {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(s, s * 1.9), matFolha);
    f.position.set(x, y, z);
    f.rotation.set(-0.4, ry, 0.35);
    grupo.add(f);
  };
  folha(-0.14, 0.62, -0.04, 0.06, 0.4);
  folha(0.05, 0.66, 0.05, 0.05, -0.6);
  folha(-0.05, 0.52, 0.0, 0.045, 1.2);

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
  // Penumbra ampla (VSM): raio alto + muitas amostras de blur = sombra macia,
  // sem o serrilhado da grade. normalBias afasta o acne das superfícies.
  sol.shadow.radius = 11;
  sol.shadow.blurSamples = 25;
  sol.shadow.bias = -0.0003;
  sol.shadow.normalBias = 0.04;
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
// Luz viva: o ciclo do dia (color grading 3D real, não filtro 2D)
//
// Reaproveita o conceito do ciclo da v3, mas agora como LUZ de verdade: a
// cor e a intensidade do sol, o ambiente, o fundo/fog, a exposição e até o
// brilho do papel shoji mudam com a hora REAL. É o coração poético — de
// madrugada a sala é luar azul e sombras longas; ao meio-dia, neutra e
// clara; ao entardecer, a madeira doura.
// ---------------------------------------------------------------------------

/** Quadros-chave da luz, de 3 em 3 horas (cíclicos: 24h volta ao 0h). Cada
 *  um descreve a luz daquele instante. Chutes iniciais — calibrar no tato. */
const QUADROS_LUZ = [
  // h,  corSol,    intSol, corAmb,    intAmb, corFundo,  elevSol, expo, shoji, corShoji
  [0, 0x8fa9d8, 0.5, 0x2b3a5a, 0.36, 0x121a2e, 0.34, 0.88, 0.32, 0x9fb8ec], // meia-noite (luar azul)
  [3, 0x88a0d0, 0.46, 0x283655, 0.34, 0x101626, 0.3, 0.88, 0.3, 0x9ab2ea], //  madrugada
  [6, 0xccd2e2, 1.2, 0xb7c1d2, 0.82, 0xc4c8cb, 0.16, 1.0, 0.55, 0xe7edf6], //  amanhecer (frio, claro)
  [9, 0xffeccf, 2.1, 0xe6dcc6, 1.0, 0xd6cdba, 0.46, 1.0, 0.78, 0xfff1da], //   manhã
  [12, 0xfff4e6, 2.5, 0xeae2cf, 1.1, 0xd9d3c2, 0.7, 1.0, 0.9, 0xfff6ea], //    meio-dia (neutro, claro)
  [15, 0xffe7c2, 2.25, 0xe9dabf, 1.0, 0xd8ccac, 0.5, 1.0, 0.85, 0xffe9c8], //  tarde (começa a dourar)
  [18, 0xffc887, 1.95, 0xdcc299, 0.86, 0xddc196, 0.15, 1.02, 0.7, 0xffce93], // dourada (âmbar, sombras longas)
  [21, 0xc88e58, 0.95, 0x5e4d3a, 0.5, 0x352a1e, 0.28, 0.92, 0.42, 0xe2a875], // anoitecer
];

const suave3 = (t) => t * t * (3 - 2 * t);

/** Interpola componente a componente um canal hex (sRGB simples). */
function lerpHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    ((Math.round(ar + (br - ar) * t) << 16) |
      (Math.round(ag + (bg - ag) * t) << 8) |
      Math.round(ab + (bb - ab) * t)) >>>
    0
  );
}

/**
 * A luz numa hora qualquer (função pura): interpola ciclicamente entre os
 * quadros-chave com smoothstep. A virada da meia-noite é tão suave quanto
 * qualquer outra (0h e 24h são o mesmo ponto).
 *
 * @param {Date} date
 * @returns {{ corSol, intSol, corAmb, intAmb, corFundo, elevSol, expo, shoji }}
 */
export function luzDaHora(date) {
  const hora = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const passo = 24 / QUADROS_LUZ.length; // 3h
  const i = Math.floor(hora / passo) % QUADROS_LUZ.length;
  const j = (i + 1) % QUADROS_LUZ.length;
  let frac = (hora - QUADROS_LUZ[i][0]) / passo;
  if (frac < 0) frac += 24 / passo;
  const t = suave3(Math.min(Math.max(frac, 0), 1));
  const a = QUADROS_LUZ[i];
  const b = QUADROS_LUZ[j];
  const num = (k) => a[k] + (b[k] - a[k]) * t;
  return {
    corSol: lerpHex(a[1], b[1], t),
    intSol: num(2),
    corAmb: lerpHex(a[3], b[3], t),
    intAmb: num(4),
    corFundo: lerpHex(a[5], b[5], t),
    elevSol: num(6),
    expo: num(7),
    shoji: num(8),
    corShoji: lerpHex(a[9], b[9], t),
  };
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
  // VSM (variance shadow map): sombras de penumbra LARGA e macia — a luz que
  // entra por papel é difusa, não cria a grade dura de "3D de jogo". O blur é
  // controlado por shadow.radius + shadow.blurSamples (ver criarLuz).
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const { cena, matShoji, matMadeira, matMadeiraEsc } = criarCena(renderer);
  const luz = criarLuz(cena);

  // Grupo das obras penduradas (limpo e remontado a cada abertura).
  const grupoObras = new THREE.Group();
  cena.add(grupoObras);
  const penduradas = []; // { dados, pos: Vector3 }

  /**
   * Pendura a coleção: a fundação no nicho de honra, as demais nas paredes
   * (com vazio entre elas). Cada obra: { id, nome, haiku, ehFundacao,
   * imagem(dataURL) }. Async (carrega as texturas).
   */
  async function pendurarObras(lista) {
    grupoObras.clear();
    penduradas.length = 0;
    let iParede = 0;
    for (const o of lista) {
      if (!o.imagem) continue;
      const slot = o.ehFundacao ? SLOT_NICHO : SLOTS_PAREDE[iParede++];
      if (!slot) continue; // excedeu a capacidade do cômodo (Fase 5: novo cômodo)
      const tex = await carregarTextura(o.imagem);
      if (!tex) continue;
      const km = criarKakemono(tex, matMadeira, matMadeiraEsc, o.ehFundacao);
      km.position.set(slot.pos[0], slot.pos[1], slot.pos[2]);
      km.rotation.y = slot.ry;
      grupoObras.add(km);
      // Dados que o clique-para-focar lê (subindo a árvore do mesh atingido):
      // a obra, o centro no mundo e a NORMAL da parede (para onde a obra
      // "olha"), além do tamanho já guardado no userData do kakemono.
      const centro = new THREE.Vector3(slot.pos[0], slot.pos[1], slot.pos[2]);
      const normal = new THREE.Vector3(Math.sin(slot.ry), 0, Math.cos(slot.ry));
      km.userData.obra = o;
      km.userData.centro = centro;
      km.userData.normal = normal;
      penduradas.push({ dados: o, pos: centro.clone() });
    }
  }

  const _fwd = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  /** A obra "em foco" (perto e na direção do olhar), ou null — para o
   *  rótulo de nome+haiku da camada 2D. */
  function obraEmFoco() {
    camera.getWorldDirection(_fwd);
    let melhor = null;
    let melhorDist = FOCO_DIST;
    for (const p of penduradas) {
      const d = p.pos.distanceTo(camera.position);
      if (d > FOCO_DIST) continue;
      _dir.subVectors(p.pos, camera.position).normalize();
      if (_fwd.dot(_dir) < 0.6) continue; // só conta se estiver olhando p/ ela
      if (d < melhorDist) {
        melhorDist = d;
        melhor = p.dados;
      }
    }
    return melhor;
  }

  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 100);
  // Olho humano perto da entrada, olhando para o tokonoma (fundo).
  camera.position.set(1.6, 1.45, 1.8);
  camera.lookAt(-0.8, 1.1, -PROFUND / 2);

  // Estado de luz ATUAL (suavizado): transiciona para luzDaHora a cada
  // quadro, então a virada minuto a minuto é imperceptível (e mudanças
  // forçadas para teste levam ~2s).
  const atual = {
    corSol: new THREE.Color(LUZ_COR),
    corAmb: new THREE.Color(AMBIENTE_COR),
    corFundo: new THREE.Color(FOG_COR),
    intSol: LUZ_INTENSIDADE,
    intAmb: AMBIENTE_INTENSIDADE,
    elevSol: 0.5,
    expo: 1.0,
    shoji: matShoji.emissiveIntensity,
    corShoji: matShoji.emissive.clone(),
  };

  const tmpCor = new THREE.Color();

  /** Aplica luzDaHora(date), interpolando suavemente o estado atual. */
  function atualizarLuz(date, dt) {
    const alvo = luzDaHora(date);
    const k = Math.min(1, dt * 0.6); // ~2s p/ acomodar uma troca brusca
    const lerp = (a, b) => a + (b - a) * k;

    atual.corSol.lerp(tmpCor.setHex(alvo.corSol), k);
    atual.corAmb.lerp(tmpCor.setHex(alvo.corAmb), k);
    atual.corFundo.lerp(tmpCor.setHex(alvo.corFundo), k);
    atual.corShoji.lerp(tmpCor.setHex(alvo.corShoji), k);
    atual.intSol = lerp(atual.intSol, alvo.intSol);
    atual.intAmb = lerp(atual.intAmb, alvo.intAmb);
    atual.elevSol = lerp(atual.elevSol, alvo.elevSol);
    atual.expo = lerp(atual.expo, alvo.expo);
    atual.shoji = lerp(atual.shoji, alvo.shoji);

    luz.sol.color.copy(atual.corSol);
    luz.sol.intensity = atual.intSol;
    // Elevação do sol: baixo = sombras longas (amanhecer/entardecer); alto
    // = sombras curtas (meio-dia). Azimute fixo (vem de fora do shoji).
    luz.sol.position.set(-8, 1.4 + atual.elevSol * 9, 3);
    luz.ceu.color.copy(atual.corAmb);
    luz.ceu.intensity = atual.intAmb;
    cena.background.copy(atual.corFundo);
    cena.fog.color.copy(atual.corFundo);
    renderer.toneMappingExposure = atual.expo;
    matShoji.emissiveIntensity = atual.shoji;
    matShoji.emissive.copy(atual.corShoji); // papel quente de dia, azul-lunar à noite
  }

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
  return {
    render,
    redimensionar,
    dispose,
    camera,
    cena,
    luz,
    renderer,
    atualizarLuz,
    pendurarObras,
    obraEmFoco,
  };
}

// ---------------------------------------------------------------------------
// Navegação em primeira pessoa (contemplativa, à prova de enjoo)
//
// Dois gestos só, iguais no mouse e no toque:
//   - ARRASTAR  → olhar ao redor (gira yaw/pitch; pitch limitado, sem rolar)
//   - TOCAR/CLICAR (sem arrastar) → se for numa OBRA, FOCA nela (aproxima até
//     quase tela cheia, de frente, com o poema embaixo); senão, caminha
//     suavemente até aquele ponto (raycast no chão/parede).
//
// Em FOCO, a vista trava de frente para a obra e o gesto vira ZOOM:
//   - roda do mouse (desktop) ou pinça de dois dedos (celular) aproxima/afasta.
// Sair do foco (botão 墨 / Esc) devolve o controle de caminhar e olhar de onde
// a câmera parou — sem teleporte.
//
// Não há WASD nem corrida: é uma "caminhada assistida", mais quieta e sem
// balanço de câmera (a metáfora do templo pede contemplação, não FPS).
// ---------------------------------------------------------------------------

const ALTURA_OLHO = 1.5; // altura dos olhos (m)
const SENS_OLHAR = 0.0010; // rad por pixel arrastado
const PITCH_LIMITE = 0.5; // ~28°: não dá para olhar o teto/chão por inteiro
const LIMIAR_ARRASTE = 6; // px: abaixo disso, é um toque (caminhar/focar)
const VEL_CAMINHAR = 2.2; // suavização do deslocamento (maior = mais rápido)
const DIST_PARADA = 1.9; // para a esta distância do ponto clicado (m)
const MARGEM_PAREDE = 0.8; // não encosta nas paredes

// Foco numa obra
const VEL_FOCO = 5; // suavização da aproximação ao focar (maior = mais rápido)
const FOCO_FILL = 0.66; // fração da ALTURA da tela que a obra ocupa ao focar
const FOCO_BOOM = 0.16; // abaixa a câmera (sobe a obra na tela; sobra p/ o poema)
const FOCO_MIN = 0.45; // zoom máximo de aproximação (m)
const FOCO_MAX = 2.4; // zoom máximo de afastamento (m)

const trava = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Instala a navegação num canvas sobre uma galeria. Retorna
 * { atualizar(dt), focoAtual(), sairFoco() } — atualizar() roda uma vez por
 * quadro antes de render; focoAtual() devolve os dados da obra focada (ou
 * null) p/ a camada 2D montar o poema; sairFoco() desfaz o foco.
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
  const _v = new THREE.Vector3();

  // --- estado de FOCO ------------------------------------------------------
  let focado = false;
  let focoObra = null;
  const focoCentro = new THREE.Vector3();
  const focoNormal = new THREE.Vector3();
  let focoH = 0.5; // altura da obra (m)
  let distFoco = 0.9; // distância câmera→obra em foco (zoom)

  // --- ponteiros (1 = arrastar/tocar; 2 = pinça p/ zoom em foco) -----------
  const ponteiros = new Map(); // id → {x, y}
  let idArraste = null;
  let ultimoX = 0;
  let ultimoY = 0;
  let andouX = 0;
  let andouY = 0;
  let distPinca = 0;

  function distanciaPonteiros() {
    const v = [...ponteiros.values()];
    if (v.length < 2) return 0;
    return Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y);
  }

  canvas.addEventListener('pointerdown', (e) => {
    ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    if (idArraste === null) {
      idArraste = e.pointerId;
      ultimoX = e.clientX;
      ultimoY = e.clientY;
      andouX = andouY = 0;
    }
    if (ponteiros.size === 2) distPinca = distanciaPonteiros();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = ponteiros.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;

    // Dois dedos: em foco, vira ZOOM (pinça). Fora de foco, ignora.
    if (ponteiros.size >= 2) {
      if (focado) {
        const d = distanciaPonteiros();
        if (distPinca > 0 && d > 0) distFoco = trava(distFoco * (distPinca / d), FOCO_MIN, FOCO_MAX);
        distPinca = d;
      }
      return;
    }

    if (e.pointerId !== idArraste) return;
    const dx = e.clientX - ultimoX;
    const dy = e.clientY - ultimoY;
    ultimoX = e.clientX;
    ultimoY = e.clientY;
    andouX += Math.abs(dx);
    andouY += Math.abs(dy);
    if (focado) return; // em foco a vista trava de frente para a obra
    // Arrastar gira a vista (resposta imediata, sem suavização — natural).
    yaw -= dx * SENS_OLHAR;
    pitch = trava(pitch + dy * SENS_OLHAR, -PITCH_LIMITE, PITCH_LIMITE);
  });

  function terminar(e) {
    if (!ponteiros.has(e.pointerId)) return;
    ponteiros.delete(e.pointerId);
    if (ponteiros.size < 2) distPinca = 0;
    if (e.pointerId !== idArraste) return;
    idArraste = null;

    // Foi um TOQUE (quase sem mover) e sem outro dedo na tela.
    if (andouX + andouY < LIMIAR_ARRASTE && ponteiros.size === 0 && !focado) {
      const grupo = obraNoPonto(e);
      if (grupo) focar(grupo);
      else caminharPara(e);
    }
    // Se ainda há um dedo (fim de pinça), ele reassume o arraste.
    if (ponteiros.size >= 1) {
      const [id, p] = [...ponteiros][0];
      idArraste = id;
      ultimoX = p.x;
      ultimoY = p.y;
      andouX = andouY = 0;
    }
  }
  canvas.addEventListener('pointerup', terminar);
  canvas.addEventListener('pointercancel', terminar);

  // Roda do mouse: zoom enquanto em foco (desktop).
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!focado) return;
      e.preventDefault();
      distFoco = trava(distFoco + e.deltaY * 0.0016 * distFoco, FOCO_MIN, FOCO_MAX);
    },
    { passive: false }
  );

  /** Sobe a árvore do mesh atingido até achar o kakemono (userData.obra). */
  function obraNoPonto(e) {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(galeria.cena.children, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData && o.userData.obra) return o;
        o = o.parent;
      }
    }
    return null;
  }

  /** Entra em FOCO numa obra: trava de frente para ela e calcula a distância
   *  que a enquadra ocupando ~FOCO_FILL da altura da tela. */
  function focar(grupo) {
    focado = true;
    focoObra = grupo.userData.obra;
    focoCentro.copy(grupo.userData.centro);
    focoNormal.copy(grupo.userData.normal);
    focoH = (grupo.userData.tamanho && grupo.userData.tamanho.h) || 0.5;
    const fov = (camera.fov * Math.PI) / 180;
    distFoco = trava(focoH / (2 * FOCO_FILL * Math.tan(fov / 2)), FOCO_MIN, FOCO_MAX);
  }

  /** Sai do foco devolvendo o controle de caminhar/olhar de onde a câmera
   *  ficou (sem teleporte): reconstrói yaw/pitch a partir da orientação atual. */
  function sairFoco() {
    if (!focado) return;
    focado = false;
    focoObra = null;
    pos.set(camera.position.x, ALTURA_OLHO, camera.position.z);
    alvo.copy(pos);
    camera.getWorldDirection(dir);
    yaw = Math.atan2(dir.x, -dir.z);
    pitch = trava(Math.asin(trava(dir.y, -1, 1)), -PITCH_LIMITE, PITCH_LIMITE);
  }

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
    // (assim clicar numa parede aproxima sem atravessar).
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
    if (focado) {
      // Câmera de frente para a obra, à distância do zoom, levemente
      // ABAIXADA (FOCO_BOOM) para a obra subir na tela e sobrar espaço
      // embaixo para o poema. A vista é horizontal e perpendicular ao
      // quadro (sem keystone): olha para o ponto na MESMA altura da câmera.
      const k = reduzMovimento ? 1 : Math.min(1, dt * VEL_FOCO);
      _v.copy(focoNormal).multiplyScalar(distFoco).add(focoCentro);
      _v.y -= FOCO_BOOM * distFoco;
      camera.position.lerp(_v, k);
      camera.lookAt(focoCentro.x, camera.position.y, focoCentro.z);
      return;
    }
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

  return { atualizar, focoAtual: () => focoObra, sairFoco };
}
