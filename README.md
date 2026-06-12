# 墨流し — suminagashi

Site interativo de *suminagashi* (marmorização japonesa: tinta pingada sobre
água, movida com um estilete). Uma simulação de fluido de verdade rodando na
GPU — em HTML, CSS e JavaScript vanilla, **zero dependências, zero build,
zero framework** (os shaders são escritos à mão dentro do projeto).

## Como rodar

Sirva a pasta com qualquer servidor estático e abra no navegador
(requer WebGL2, presente em todo navegador moderno):

```sh
npx serve
# ou: python3 -m http.server
```

> É preciso um servidor (não abrir o arquivo direto) porque o projeto usa
> ES Modules nativos, e navegadores bloqueiam `import` via `file://`.

### Deploy (GitHub Pages)

O repositório já vem com o workflow `.github/workflows/pages.yml`: todo
push na `main` publica o site automaticamente. Só é preciso ativar uma vez
em **Settings → Pages → Source: "GitHub Actions"**. Não há build — a raiz
do repositório é o site (todos os caminhos são relativos, então funciona
em `usuario.github.io/repositorio/` sem configuração).

Funciona com mouse e com toque:

- **toque/clique rápido** — pinga uma gota da cor selecionada, que se
  espalha e empurra a tinta vizinha;
- **arrastar** — estilete: cria correnteza que carrega a tinta, com
  momentum e redemoinhos de verdade;
- **água** (swatch da cor do papel) — gota que só empurra, sem pintar;
  alterne tinta e água no mesmo ponto para os anéis clássicos;
- **lavar** — dissolve a obra com um fade suave.

## A física (stable fluids, na GPU)

A água é simulada pelas equações de **Navier-Stokes** para um fluido
incompressível, pelo método *stable fluids* de Jos Stam (1999). Duas grades
vivem em texturas WebGL — a **velocidade** da correnteza (grade grossa,
ela é suave por natureza) e a **tinta** (grade fina, é onde o olho repara)
— e cada passo da física é um shader que reescreve uma grade inteira, uma
célula por thread da GPU. Por quadro:

1. **Advecção semi-lagrangiana** — em vez de empurrar valores para frente
   (instável), cada célula recua pela correnteza e pergunta "que valor
   estava aqui há um instante?". Nunca explode, só amacia.
2. **Confinamento de vorticidade** — a advecção numérica borra os
   redemoinhos pequenos; este passo os detecta (pelo rotacional) e os
   realimenta. É o que mantém as espirais finas vivas.
3. **Ondulação** — a "respiração" da água: uma aceleração derivada de uma
   função de corrente `ψ(x, y, t)` (incompressível por construção) mantém
   a bacia em movimento perpétuo e sutil, como uma superfície real.
4. **Projeção de pressão** — calcula a divergência da correnteza, resolve
   `∇²p = div` por iterações de Jacobi e subtrai o gradiente: o que sobra
   é incompressível — água que circula sem se acumular nem rarefazer.
5. A correnteza **carrega a tinta** (advecção de novo, agora do corante).

Os gestos viram *splats* gaussianos: a gota pinta corante e injeta um
empurrão radial (o anel que abre espaço); o estilete injeta correnteza na
direção do movimento — e a física faz o resto.

> A primeira versão deste projeto usava outra técnica — o marbling
> geométrico de Aubrey Jaffer, com gotas como polígonos de borda nítida e
> fórmulas fechadas. Ela vive no histórico do git, caso um dia exista um
> "modo anéis nítidos".

## Estrutura

```
index.html
styles.css
js/
  prng.js     # PRNG seedável (mulberry32) — determinismo desde o dia 1
  fluido.js   # motor: solver de Navier-Stokes em WebGL2 + shaders
  input.js    # pointer events → gestos (tap = gota, drag = estilete)
  main.js     # orquestração, UI, loop de animação
```

`fluido.js` conhece WebGL mas não conhece a página: recebe um canvas e
comandos (pingar, mexer, lavar). Toda aleatoriedade passa pelo PRNG
seedável de `prng.js` — um modo futuro vai reproduzir obras inteiras a
partir de um seed compartilhável.
