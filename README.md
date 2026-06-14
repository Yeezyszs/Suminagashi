# 墨流し — suminagashi

Site interativo de *suminagashi* (marmorização japonesa: tinta pingada sobre
água, movida com um estilete). Uma simulação de fluido de verdade rodando na
GPU — em HTML, CSS e JavaScript vanilla, **zero dependências, zero build,
zero framework** (os shaders são escritos à mão dentro do projeto).

## Como rodar

Sirva a pasta com qualquer servidor estático e abra no navegador
(requer WebGL2, presente em todo navegador moderno):

```sh
npx serve docs
# ou: python3 -m http.server -d docs
```

> É preciso um servidor (não abrir o arquivo direto) porque o projeto usa
> ES Modules nativos, e navegadores bloqueiam `import` via `file://`.

### Deploy (GitHub Pages)

O site vive na pasta **`docs/`** e não há build, então **os dois modos**
do Pages funcionam:

- **Deploy from a branch** → branch `main`, pasta `/docs` (o
  `docs/.nojekyll` pula o processamento Jekyll); ou
- **GitHub Actions** → o workflow `.github/workflows/pages.yml` publica
  `docs/` a cada push na `main`.

Todos os caminhos são relativos, então funciona em
`usuario.github.io/repositorio/` sem configuração extra.

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

Os gestos viram *splats* gaussianos: a gota deposita pigmento e injeta um
empurrão radial (o anel que abre espaço); o estilete injeta correnteza na
direção do movimento — e a física faz o resto.

## As cores (Beer-Lambert: pigmento de verdade)

A textura de tinta não guarda cor — guarda **densidade óptica**: quanto
pigmento absorvendo luz existe em cada ponto. A cor que você vê é a luz do
papel atravessando esse pigmento:

```
cor = papel · exp(−densidade)
```

É a lei de Beer-Lambert, a física da tinta real (mistura **subtrativa**):
pigmento azul absorve o vermelho da luz, pigmento amarelo absorve o azul —
onde os dois se encontram, sobra o **verde**. Em RGB comum, azul + amarelo
daria um cinza lavado. E como misturar é *somar densidades*, muitas camadas
escurecem naturalmente, como tinta saturando o papel. A "água" subtrai
densidade (dispersante abrindo a tinta) — é ela que desenha os anéis claros
do suminagashi clássico.

Na barra: 10 tintas + água, e **segurar um swatch (~450ms)** abre um seletor
para personalizá-lo (persiste no navegador).

## O tokonoma (a sala)

O site não é "um canvas com uma barra de cores" — é um **tokonoma** (床の間),
o nicho de exposição da casa japonesa: madeira, vazio que respira, UMA obra
em foco. A UI quase desaparece e a água é tudo. Três estados:

- **ocioso** — só a água viva respira em tela cheia; um título vertical num
  canto e a "lombada" da estante espiando na margem. Nada mais.
- **pintando** — ao tocar, as ferramentas (gotas-cor + guardar) emergem;
  recuam sozinhas após alguns segundos parados.
- **estante** — puxada pela aba lateral, expõe **uma obra por vez** como um
  pergaminho (kakemono), com navegação horizontal entre as obras guardadas.

**A luz da sala (atmosfera).** Uma camada de luz banha a tela inteira,
combinando duas fontes (ver `luz.js`, funções puras):

1. *o ciclo* — o relógio do dispositivo vira luz contínua, minuto a minuto:
   luar frio de madrugada, meio-dia neutro, tarde dourada.
2. *o tom da fundação* — a **primeira pintura** define a temperatura base da
   sala. O relógio dá o movimento; a fundação dá o tom. Dois usuários às 18h
   veem entardeceres diferentes porque fundaram salas diferentes.

**Guardar** é o único momento "alto" do site (e o único vermelho): a água
assenta, um **selo hanko** (印) carimba a obra, ela se **enrola em
pergaminho** e é recolhida para a estante. Cada obra ganha um nome em PT-BR
gerado da hora + temperatura (ex.: "Maré da Noite", "Âmbar das Três"),
renomeável depois. Na estante, **exportar** baixa a obra em PNG **4K**,
pronta para wallpaper.

A **resolução é adaptativa**: o detalhe de uma exportação é o detalhe com
que a simulação rodou (ampliar não cria nitidez), então desktops potentes
rodam a grade de tinta bem mais fina (até ~3640px nativos) e celulares
ficam leves. As imagens das obras (1–3MB) ficam no **IndexedDB**; só os
metadados leves no localStorage. A exportação sai na **proporção exata da
sua tela** (preenchendo, com recorte central) — o wallpaper encaixa sem o
sistema operacional ter de esticar ou recortar.

**Ritual de entrada (primeira visita).** A sala nasce neutra e convida:
*"pinte. esta sala vai nascer das suas cores."* Você pinta; após alguns
gestos e ~10s de quietude a água assenta, a sala ganha alma (o tom da
fundação) e a obra vira o primeiro pergaminho da estante. Tudo fica só no
seu navegador (`localStorage`); nada sai dele.

## Estrutura

```
index.html
styles.css
js/
  prng.js     # PRNG seedável (mulberry32) — determinismo desde o dia 1
  fluido.js   # motor: solver de Navier-Stokes em WebGL2 + shaders
  input.js    # pointer events → gestos (tap = gota, drag = estilete)
  luz.js      # atmosfera: ciclo do relógio + tom da fundação (puro)
  estante.js  # nomes das obras + metadados (puro)
  main.js     # orquestração, estados, guardar, estante, loop
```

`fluido.js` conhece WebGL mas não conhece a página: recebe um canvas e
comandos (pingar, mexer, lavar). Toda aleatoriedade passa pelo PRNG
seedável de `prng.js` — um modo futuro vai reproduzir obras inteiras a
partir de um seed compartilhável.
