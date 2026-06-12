# Progresso — Motor de Suminagashi

Registro do que já foi construído, em que pé está cada coisa e o que vem a
seguir. Documento vivo: atualizar a cada marco.

_Última atualização: 12/06/2026 — branch `claude/quirky-maxwell-vrwsbg`_

---

## Onde estamos

A **v1 (motor + modo livre)** está funcional e, na prática, **superou o
brief**: a pedido, o motor de marbling geométrico foi substituído por uma
**simulação de fluido real em WebGL2**, que entrega a fluidez de um
suminagashi autêntico — tinta que se mistura, esfumaça, redemoinha e agora
bate nas bordas e volta.

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

---

## Arquitetura atual

```
suminagashi/
  index.html        # tela cheia: canvas + título + dica + barra de cores
  styles.css        # UI quieta, touch-action: none, prefers-reduced-motion
  js/
    prng.js         # PRNG seedável (mulberry32) — determinismo desde o dia 1
    fluido.js       # MOTOR: solver de Navier-Stokes em WebGL2 + shaders GLSL
    input.js        # Pointer Events → gestos (tap = gota, drag = estilete)
    main.js         # orquestração, UI, loop de animação
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
grossa, 144) e **tinta** (grade fina, 720). Cada passo é um shader. Por
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
6. **Advecção da tinta** — a correnteza carrega o corante.

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
3. **Ritual de entrada** (1ª pintura define o tema do site, em localStorage).
4. **Modo som** (Web Audio).
5. **Extração de paleta/temperamento** da obra.

---

## Como rodar

```sh
npx serve          # ou: python3 -m http.server
# abrir a URL no navegador (requer WebGL2)
```
