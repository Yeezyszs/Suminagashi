# Progresso — Motor de Suminagashi

Registro do que já foi construído, em que pé está cada coisa e o que vem a
seguir. Documento vivo: atualizar a cada marco.

_Última atualização: 13/06/2026 (v3) — branch `main`_

---

## Onde estamos

A **v1 (motor)**, a **v2 (cores + pigmento)** e a **v3 (o tokonoma)** estão
funcionais. O motor de marbling geométrico do brief original foi substituído
por uma **simulação de fluido real em WebGL2** (a pedido, após o vídeo de
referência), com mistura de pigmento físico (Beer-Lambert) e paredes que
refletem a tinta. A experiência foi redesenhada como um **tokonoma**: a UI quase
desaparece, a água é tudo, e há um sistema de luz (atmosfera) e uma estante
de obras guardadas com o gesto cerimonial de "guardar".

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

---

## Arquitetura atual

```
suminagashi/
  docs/             # o site publicado pelo GitHub Pages (sem build)
    index.html      # canvas + atmosfera + título vertical + estante
    styles.css      # tokonoma: UI quase invisível, tokens de design
    js/
      prng.js       # PRNG seedável (mulberry32) — determinismo desde o dia 1
      fluido.js     # MOTOR: solver de Navier-Stokes em WebGL2 + shaders GLSL
      input.js      # Pointer Events → gestos (tap = gota, drag = estilete)
      luz.js        # atmosfera: ciclo do relógio + tom da fundação (puro)
      estante.js    # nomes das obras + metadados (puro)
      main.js       # orquestração, estados, guardar, estante, loop
  .github/workflows/pages.yml  # deploy automático a cada push na main
  README.md         # como rodar + explicação da física
  PROGRESSO.md      # este arquivo
  package.json      # metadados (sem dependências)
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
