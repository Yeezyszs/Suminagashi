# 墨流し — suminagashi

Site interativo de *suminagashi* (marmorização japonesa: tinta pingada sobre
água, movida com um estilete). Arte generativa em HTML, CSS e JavaScript
vanilla — **zero dependências, zero build, zero framework**.

## Como rodar

Sirva a pasta com qualquer servidor estático e abra no navegador:

```sh
npx serve
# ou: python3 -m http.server
```

> É preciso um servidor (não abrir o arquivo direto) porque o projeto usa
> ES Modules nativos, e navegadores bloqueiam `import` via `file://`.

Funciona com mouse e com toque:

- **toque/clique rápido** — pinga uma gota da cor selecionada;
- **arrastar** — estilete: puxa a tinta na direção do gesto;
- **água** (swatch da cor do papel) — pinga uma gota invisível que *empurra*
  a tinta existente; alterne tinta e água no mesmo ponto para criar os anéis
  concêntricos do suminagashi clássico;
- **lavar** — dissolve a obra com um fade suave.

## Testar o motor

O motor é matemática pura (sem DOM), então roda direto no Node:

```sh
node teste-motor.js
```

## A matemática (técnica de Aubrey Jaffer)

Nada de simulação de fluido: cada gota é um **polígono fechado** (um círculo
de ~120 vértices), e cada ação física vira uma fórmula fechada aplicada a
todos os vértices de todas as gotas.

**1. Pingar uma gota** de centro `C` e raio `r` empurra cada vértice `P`
das gotas existentes para longe do centro:

```
P' = C + (P − C) · sqrt(1 + r² / |P − C|²)
```

Em palavras: um ponto a distância `d` do centro vai parar a distância
`sqrt(d² + r²)`. Isso **preserva área** — a tinta deslocada ocupa exatamente
o espaço antigo mais a área da gota nova, como um líquido incompressível.
Perto da gota o empurrão é forte; longe, tende a zero.

**2. O estilete** na posição `F`, movendo na direção unitária `M` com
intensidade `z` (proporcional à velocidade do gesto), arrasta cada vértice
`P` a distância `d = |P − F|` do dedo:

```
P' = P + M · z · (λ / (λ + d))²
```

A tinta sob o dedo acompanha o gesto por inteiro; a influência decai com a
distância (`λ` ≈ 60px é o raio de influência), o que dá a sensação de um
estilete fino puxando a superfície.

**Reamostragem:** deformações esticam as arestas dos polígonos; arestas
mais longas que um limiar são subdivididas (ponto médio) para a borda
continuar lisa, com teto de ~600 vértices por gota para limitar o custo.

## Estrutura

```
index.html
styles.css
js/
  prng.js      # PRNG seedável (mulberry32) — determinismo desde o dia 1
  engine.js    # motor de marbling — matemática pura, zero DOM/canvas
  renderer.js  # desenha o estado do motor num canvas 2D
  input.js     # pointer events → gestos (tap = gota, drag = estilete)
  main.js      # orquestração, UI, loop de animação
teste-motor.js # verificação do motor em Node, sem framework
```

A separação importa: `engine.js` não conhece DOM nem canvas, então modos
futuros (replay determinístico por seed, export em alta resolução) poderão
reusar o motor fora do fluxo interativo.
