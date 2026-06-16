# Progresso — Motor de Suminagashi

Registro do que já foi construído, em que pé está cada coisa e o que vem a
seguir. Documento vivo: atualizar a cada marco.

_Última atualização: 16/06/2026 (caligrafia) — branch `main`_

---

## Onde estamos

A **v1 (motor)**, **v2 (pigmento)**, **v3 (tokonoma)**, **v4 (modos +
cosmos + batismo)** e **v5 (cosmos = pintura de luz)** estão funcionais. O
motor de marbling geométrico do brief original foi substituído
por uma **simulação de fluido real em WebGL2** (a pedido, após o vídeo de
referência), com mistura de pigmento físico (Beer-Lambert) e paredes que
refletem a tinta. A experiência foi redesenhada como um **tokonoma**: a UI quase
desaparece, a água é tudo, e há um sistema de luz (atmosfera) e uma estante
de obras guardadas com o gesto cerimonial de "guardar".

A partir da **v6** o projeto ganhou uma segunda metade: **O Templo**, uma
galeria 3D em primeira pessoa (Three.js **vendorado localmente** — única
dependência, congelada no repo, abre offline). A aba da estante agora abre o
templo: um cômodo de tatami com luz que muda pela hora real, as obras
penduradas como **kakemono**, e o gesto de **focar** uma obra (aproximar até
quase tela cheia, com zoom e um poema bilíngue japonês↔PT). A **v8** vestiu a
sala: sombras macias, materiais mais vividos e mobília tradicional (andon,
mesa de pintura preparada, tokonoma com arranjo). O ateliê (a água) segue
vanilla e intocado — o Three.js só é carregado sob demanda ao abrir o templo.

Restrições do brief mantidas: **zero dependências, zero build, zero
framework**. Abre com qualquer servidor estático. Comentários em PT-BR com
tom educacional. UI mínima e em português.

> Mudança de rota relevante: o brief pedia **Canvas 2D, sem WebGL**. Diante
> do vídeo de referência, decidimos juntos migrar para WebGL2 — era a única
> forma de atingir aquela fluidez. O motor de polígonos original continua
> preservado no histórico do git (commits `5cfc57d`–`1248909`).

---

## Linha do tempo

| # | Commit | Marco | O que entregou |
|---|--------|-------|----------------|
| 1 | `5cfc57d` | **v1: motor + modo livre** | Motor de marbling de Aubrey Jaffer (gotas como polígonos, deslocamento por inserção, estilete, reamostragem), PRNG seedável, renderer Canvas 2D, input por Pointer Events, UI completa, testes em Node. |
| 2 | `1855d45` | **Fluidez (1ª tentativa)** | Crescimento animado da gota, inércia do estilete, sub-passos, bordas em curvas. Ainda "seco". |
| 3 | `1248909` | **Água viva** | Campo de correnteza ambiente (função de corrente ψ) — a tinta passa a derivar sozinha. Melhorou, mas não era fluido de verdade. |
| 4 | `11a37e9` | **Motor novo: fluido real** | Reescrita completa: Navier-Stokes na GPU (stable fluids de Jos Stam). Esta é a fluidez desejada. |
| 5 | `beef5da` | **Paredes** | A tinta bate na borda e volta (condição de não-penetração). |
| 6 | `d059272` | **Nitidez** | Advecção MacCormack (anti-difusão), grades mais finas, menos serrilhado. |
| 7 | `b91b499` | **Deploy** | Site movido para `docs/`; GitHub Pages funcionando nos dois modos. |
| 8 | `df3e426` | **v2 cores** | Mistura subtrativa Beer-Lambert (densidade óptica), 10 tintas + água que dilui, cor personalizada por long-press. |
| 9 | `205cdfb` | **v2 ritual** | Ritual de entrada: a primeira pintura define o tema do site (cores + calma), persistido em localStorage com selo da fundação. |
| 10 | `55f5e22` | **Textura limpa** | Tinta assentada cremosa (dose de nitidez MacCormack + vorticidade/ondas mais calmas). |
| 11 | (luz) | **v3 luz** | Sistema de atmosfera de duas camadas: ciclo do relógio + tom da fundação. |
| 12 | (tokonoma) | **v3 tokonoma** | Redesenho completo: estados ocioso/pintando/estante, sequência de guardar (hanko + pergaminho), estante de obras. |
| 13 | (qualidade) | **Export 4K** | Resolução adaptativa, captura nativa, IndexedDB, export na proporção da tela. |
| 14 | (v4) | **Modos + Cosmos + Batismo** | Organização de modos (água/cosmos como config), render emissivo, alternância; nome e haiku locais determinísticos. |
| 15 | (v5) | **Cosmos = pintura de luz** | Redesenho: cosmos deixa de ser "fluido no espelho" e vira motor de acúmulo de luz (poeira→estrela por limiar, sopro, vazio, assentar). |
| 16 | `dc95793`+ | **v6: O Templo (3D)** | Galeria 3D em 1ª pessoa (Three.js vendorado, import dinâmico). Cômodo tokonoma, navegação POV à prova de enjoo, luz viva por hora (`luzDaHora`), obras como kakemono, integração ateliê↔templo, focar+zoom+poema bilíngue, baixar/apagar no foco. |
| 17 | `01bed7f`+ | **v8: Vestir o templo** | Sombras macias (VSM), materiais vividos (tatami real com heri/trama alternada, parede de argila, madeira orgânica) e mobília: tokonoma com arranjo, andon (luz quente noturna), mesa+almofada+bacia preparada para a v9. |
| 18 | (perf) | **Movimentação + FPS** | Sombra sob demanda (não a 60fps), mapa menor/justo, qualidade adaptativa por FPS real; amortecimento de câmera independente de FPS. |
| 19 | `4acfe78`+ | **Caligrafia: traçar o haiku** | Coleção curada de haikus clássicos (verificada) + seleção que lê a obra; tira de traçar (kanji fantasma + pincel sumi) no ritual de guardar; caligrafia salva e exibida na galeria 3D (pergaminho-irmão + tradução/autor no foco). |

---

## Arquitetura atual

```
suminagashi/
  docs/             # o site publicado pelo GitHub Pages (sem build)
    index.html      # canvas + atmosfera + título + estante + templo (canvas 3D)
    styles.css      # tokonoma: UI quase invisível, tokens de design
    galeria-teste.html # preview isolado do templo (?hora= força o relógio)
    js/
      prng.js       # PRNG seedável (mulberry32) — determinismo desde o dia 1
      fluido.js     # MOTOR: solver de Navier-Stokes em WebGL2 + shaders GLSL
      input.js      # Pointer Events → gestos (tap = gota, drag = estilete)
      modos.js      # os dois modos (água/cosmos) + pools do poema bilíngue
      luz.js        # atmosfera 2D: ciclo do relógio + tom da fundação (puro)
      estante.js    # batismo: nome, haiku e poema locais, determinísticos
      haiku.js      # coleção curada de haikus clássicos + seleção que lê a obra
      caligrafia.js # a tira de traçar o haiku (pincel sumi) do ritual de guardar
      galeria.js    # O TEMPLO: cena 3D (Three.js) — sala, luz por hora,
                    #   kakemono, foco/zoom, mobília. Carregado sob demanda.
      main.js       # orquestração, estados, modos, guardar, estante, templo
      vendor/
        three.module.js  # Three.js r160 VENDORADO (única dep, offline)
  .github/workflows/pages.yml  # deploy automático a cada push na main
  README.md         # como rodar + explicação da física
  PROGRESSO.md      # este arquivo
  package.json      # metadados (sem dependências de runtime)
```

**Separação de responsabilidades:** `fluido.js` conhece WebGL mas não
conhece a página (recebe canvas + comandos); `input.js` não conhece o motor
(emite gestos via callbacks); `main.js` é o único que liga tudo. Toda
aleatoriedade passa pelo PRNG seedável — base para o futuro replay por seed.

---

## Como funciona o motor (resumo)

A água é simulada pelas equações de **Navier-Stokes** para fluido
incompressível (método *stable fluids*, Jos Stam 1999), rodando inteiramente
na GPU. Duas grades vivem em texturas: **velocidade** da correnteza (grade
grossa, 176) e **tinta** (grade fina, 1024). Cada passo é um shader. Por
quadro:

1. **Advecção da velocidade** — a correnteza carrega a si mesma (semi-
   lagrangiana, incondicionalmente estável).
2. **Confinamento de vorticidade** — reaviva os redemoinhos que a grade
   borra (Fedkiw 2001); é o que mantém as espirais vivas.
3. **Ondulação** — a "respiração" da água: correnteza ambiente sutil e
   perpétua, derivada de uma função de corrente ψ (incompressível por
   construção).
4. **Contorno** — as paredes refletem a velocidade normal (não-penetração):
   a tinta bate na borda e volta; tangente livre (escorrega na margem).
5. **Projeção de pressão** — divergência → Jacobi (24 iter.) → subtrai o
   gradiente: impõe incompressibilidade.
6. **Advecção da tinta** — em duas passadas (MacCormack: mede e compensa o
   erro de interpolação — filamentos continuam nítidos).

**Cores:** a textura de tinta guarda **densidade óptica** (Beer-Lambert):
`cor = papel · exp(−D)`. Pingar soma densidade; "água" subtrai (dilui).
Azul + amarelo → verde, como pigmento de verdade. A atmosfera (luz da
sala) é um overlay DOM por cima de tudo, derivada da hora + tom da fundação.

**Dois motores irmãos:** a ÁGUA é o solver de fluido acima. O COSMOS NÃO é
fluido — é pintura de luz (correção do v4): um buffer de acúmulo onde a poeira
(cores) deposita luz aditiva que acumula em camadas; estrelas FLORESCEM onde o
acúmulo cruza um limiar (grade no main); sopro espalha, vazio apaga. A tela
fica parada (o loop só roda o solver em água), com cintilação + um "assentar"
pós-gesto que decai e para. Render: tonemap (vazio+(1−exp(−luz))) + estrelas.

Gestos viram *splats* gaussianos: a **gota** pinta corante + empurra a água
em anel (abre espaço); a **água** (cor do papel) só empurra — anéis
clássicos. O **estilete** impõe à água local a velocidade real do dedo
(px/s, medida por timestamp e suavizada) — arrasto sem deslizamento, auto-
limitado.

Todo o ajuste de "personalidade" da água está em **constantes nomeadas** no
topo de `fluido.js` (dissipação, vorticidade, força da gota, ondas...).

---

## Funcionalidades prontas (modo livre)

- [x] Pingar gota da cor selecionada (raio com variação via PRNG)
- [x] Estilete por arraste (correnteza que dobra a tinta)
- [x] Tap vs drag por limiar de movimento (6px)
- [x] Cor "água" (cor do papel) → anéis concêntricos clássicos
- [x] Respiração ambiente (a água nunca está parada)
- [x] Paredes: tinta bate na borda e volta
- [x] Botão "lavar" com fade suave (~600ms)
- [x] Paleta de 5 cores em constantes fáceis de trocar
- [x] Título discreto + dica efêmera no primeiro acesso
- [x] `prefers-reduced-motion` respeitado
- [x] `devicePixelRatio` respeitado (teto 2)
- [x] Fallback claro quando não há WebGL2
- [x] UI 100% em PT-BR

### v2 — cores e ritual

- [x] Mistura subtrativa Beer-Lambert (azul+amarelo→verde; camadas saturam)
- [x] Água dilui pigmento (anéis claros, fiel ao dispersante real)
- [x] 10 tintas + água; barra rolável no mobile (pan-x só nela)
- [x] Long-press num swatch → cor personalizada (localStorage, anel fino,
      restaurar padrão)
- [x] Ritual de entrada: convite → pintura → assentamento por inatividade
      (≥3 gestos + 10s; cancelável; UI esmaece sem countdown)
- [x] Extração de tema: dominantes por matiz ponderadas por densidade;
      acento com contraste WCAG AA; fundo dessaturado; papel com tint
- [x] Temperamento: telemetria de gesto → calma ∈ [0,1] → ritmo da água e
      duração das transições (função pura calibrável em ritual.js)
- [x] Persistência ritual.v1 (tema, calma, miniatura JPEG, telemetria
      local); retorno abre vestido; selo da fundação com "refazer o ritual"
- [x] Casos de borda: reduced-motion (cortes), obra vazia (sem tema),
      localStorage indisponível (vale só na sessão), lavar não conta gesto

### v3 — o tokonoma (UI/UX)

- [x] Estados ocioso/pintando/estante com transições suaves
- [x] Título vertical (writing-mode) + aba da estante respirando na margem
- [x] Ferramentas emergem ao tocar, recuam após ~4s; cores como gotas (sem
      cápsula branca)
- [x] Atmosfera de 2 camadas: ciclo do relógio (minuto a minuto) modulado
      pelo tom da fundação; overlay DOM barato; ?hora= para testar
- [x] Sequência de guardar: assentar → selo hanko (印, único vermelho) →
      enrolar em pergaminho → recolher para a estante → água limpa
- [x] Nome gerado em PT-BR (água/luz + hora), renomeável na estante
- [x] Estante-tokonoma: uma obra por vez, navegação (setas/teclado/swipe),
      metadados, fundação marcada com 元 e impossível de apagar
- [x] Persistência: fundacao.v1 (tom da luz) + estante.v1 (obras)
- [x] reduced-motion colapsa todas as sequências em cortes
- [x] Exportar obra em PNG 4K (wallpaper-ready), capturada na resolução
      NATIVA da grade de tinta
- [x] Resolução de tinta ADAPTATIVA (desktop forte ~2048 → ~3640px
      nativos; mobile 1024) — detalhe real, não ampliação
- [x] Imagens das obras no IndexedDB (cota grande); metadados no
      localStorage; migração das obras antigas embutidas

---

## O Templo (galeria 3D — v6 / v8)

Segunda metade do projeto: **pintar é vanilla (a água), expor é 3D (o
templo)**. O Three.js é a única dependência, **vendorada** em
`docs/js/vendor/three.module.js` (r160), resolvida por import map e carregada
por **import dinâmico** só ao abrir o templo — o ateliê nunca o carrega.

- [x] Cômodo de tatami (6×5 m) com shoji (parede de papel por onde o sol
      entra), tokonoma (nicho de honra), vigas e teto de madeira clara.
- [x] Navegação POV contemplativa: arrastar = olhar; tocar = caminhar
      (sem WASD, sem balanço — à prova de enjoo).
- [x] **Luz viva por hora** (`luzDaHora`): cor/intensidade do sol, ambiente,
      fundo, exposição e brilho do shoji interpolados pela hora REAL (luar
      azul de madrugada → neutro ao meio-dia → âmbar ao entardecer).
- [x] Obras penduradas como **kakemono** (a fundação no nicho, marcada 元).
- [x] **Focar** uma obra (clique): a câmera aproxima de frente até quase tela
      cheia, com **zoom** (roda do mouse / pinça), o **poema** em japonês
      (caligrafia vertical) e uma janelinha de **tradução** PT — bilíngue e
      determinístico por obra. Baixar (PNG 4K) e apagar no foco.
- [x] **v8 — vestir:** sombras macias (VSM, penumbra difusa), tatami real
      (heri + trama alternada), parede de argila, madeira orgânica; mobília:
      andon (luz quente que acende à noite), tokonoma com arranjo (vaso +
      galho), mesa baixa + almofada + bacia.

**Preparado para o futuro (vagas montadas, sem nada definitivo a arrancar):**

- A **mesa baixa + bacia (suiban)** é a peça da **v9**: dali se vai pintar, em
  POV sentado ("sentar é pintar, levantar é contemplar"). A água da bacia é um
  **placeholder estático** — a v9 fará a costura 2D↔3D (render-to-texture do
  motor de fluido sobre o plano da bacia). **Nenhuma** integração 2D↔3D agora.
- O **vaso/arranjo do tokonoma** é a vaga da futura feature de **cultivo**: o
  usuário poderá produzir o próprio bonsai/ikebana. Hoje há um arranjo-padrão
  provisório, pronto para ser substituído.
- **Próximos cômodos (v?):** a sala tem capacidade ~8 obras; quando enche, a
  ideia é ramificar em novos cômodos (cada um com seu arranjo e sua era). A
  riqueza do templo vem da quantidade de cômodos, não do entulho de uma sala.

---

## Caligrafia: traçar o haiku (fecha o arco "pinta + batiza com as mãos")

Dentro do ritual de guardar, ANTES do selo: o site **lê a obra** (temperatura
da calidez + energia do gesto + estação do dia + lua no cosmos) e **escolhe um
haiku clássico** de domínio público de melhor clima (`haiku.js` —
determinístico pela semente da obra). Surge uma **tira de papel** com o haiku em
**kanji fantasma** (fonte mincho do sistema, vertical) e o usuário o **traça**
com um pincel sumi (`caligrafia.js` — mini-canvas, NÃO o fluido); pode
desfazer/limpar/pular/selar. Ao selar salva-se **só o traço** (PNG transparente).

- [x] Coleção de 14 haikus (Bashō, Buson, Issa, Chiyo-ni, Shiki) — os `jp`
      (texto traçável) **verificados contra fontes confiáveis** (Wikipédia JP,
      páginas acadêmicas). Expansível para ~30-50.
- [x] Seleção pura e determinística (estação respeita o hemisfério; Sul por
      padrão). Testada com obras opostas.
- [x] Persistência: a obra ganha `haikuId/Jp/Romaji/Pt/Autor`; a caligrafia
      vai para o IndexedDB (`id#cal`), apagada junto com a obra.
- [x] Galeria 3D: a caligrafia aparece como **pergaminho-irmão** ao lado da
      pintura; o **foco** revela o haiku (vertical) + tradução PT + autor.
- [x] `pular` gracioso; `prefers-reduced-motion`; fonte do sistema; offline.
- [ ] Expandir a coleção; (futuro) modo de traço GUIADO (ordem dos kanji).

---

## Pendências / riscos conhecidos

- [ ] **Validar 60fps em hardware real** (desktop + celular). Os testes
      automáticos rodaram em GPU emulada por software; falta confirmação no
      dispositivo. _É o critério de aceite nº 4 do brief._
- [ ] **Resolução adaptativa**: a grade de tinta é fixa (720). Em celular
      fraco pode pesar — falta baixar a resolução automaticamente ao
      detectar queda de FPS.
- [ ] **Teste de toque real** no mobile (sem zoom/scroll acidental).
- [ ] O redimensionamento da janela descarta a obra (raro: rotação de
      tela). Preservar exigiria re-advectar entre grades — adiado de
      propósito.

---

## Próximos passos (pós-v1)

Funcionalidades do brief marcadas como "fora de escopo da v1", em ordem
sugerida:

1. **Export PNG em alta resolução (4K/8K).** Ficou quase trivial com o motor
   de fluido — renderizar a textura de tinta num framebuffer grande.
   Gratificação imediata para o usuário. _Próxima entrega recomendada._
2. **Modo zen / código compartilhável por seed.** ⚠️ Decisão arquitetural
   pendente: com fluido na GPU, o replay determinístico pixel-a-pixel
   **não é garantido** (GPUs diferem em ponto flutuante). Caminho viável:
   gravar a *sequência de gestos*, não confiar na reprodução numérica
   idêntica. O PRNG e o registro de comandos já estão preparados.
1. **Modo som** (Web Audio).

(Ritual de entrada, extração de paleta/temperamento e o tokonoma já
entregues.)

---

## Como rodar

```sh
npx serve          # ou: python3 -m http.server
# abrir a URL no navegador (requer WebGL2)
```
