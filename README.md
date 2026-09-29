# Kage — jogo ninja 3D

Jogo de ação em terceira pessoa no navegador, feito com React, Vite e Three.js. Cenário, texturas e efeitos são gerados por código. O personagem jogável (O Rōnin) é um modelo rigado no Mixamo com animações de captura de movimento (`public/models/ronin.glb`), com combate em estilo Souls: cada golpe causa dano no frame de impacto do próprio clipe, combos só encadeiam dentro da janela de cada golpe e a esquiva só corta a recuperação. Os samurais inimigos alternam entre o Rōnin recolorido e um segundo modelo de samurai (ambos em versão leve, mesmos golpes e IA); o arqueiro inimigo tem modelo próprio com animações de arco longo (puxa, mira e solta, com corda dinâmica e flecha encaixada), chuta quem encosta e, a partir da onda 4, esquiva de golpes; o chefe é um gigante com a espada gigante e golpes do Rōnin transferidos para o esqueleto dele (golpe de cima, salto com golpe e varrida), com rugido de entrada; armas do jogador e dos inimigos são modelos 3D (`public/models/weapons/`). Controles sensíveis ao toque para celular e câmera automática.

## Rodando localmente

Pré-requisitos: Node.js 20.19+ ou 22.12+.

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Build de produção

```bash
npm run build   # gera dist/
npm run preview # serve dist/ localmente para conferir
```

## Deploy no Netlify

O repositório já traz `netlify.toml` (comando de build, pasta publicada, versão do Node e cache). Basta conectar o repositório no Netlify — nenhuma variável de ambiente é necessária, o jogo não usa nenhuma chave de API.

## Deploy no GitHub Pages

O workflow `.github/workflows/pages.yml` gera o build e publica em `https://johnnybahia.github.io/ninja/` a cada push na `main`. Uma vez só: em *Settings → Pages → Build and deployment → Source*, escolha **GitHub Actions** (não "Deploy from a branch" — a raiz e `/docs` não servem, o jogo precisa ser compilado). O caminho base `/ninja/` é passado ao build pela variável `VITE_BASE`; sem ela (Netlify, `npm run dev`) o base é `/`.

## Estrutura

- `src/game/` — motor do jogo (Three.js puro): cenário (`world.ts`, `garden.ts`), personagens procedurais (`characters.ts`, `animation.ts`, `rigs.ts`), personagem com mocap (`clipRig.ts`), tabela de golpes com frames de impacto e janelas de combo (`moves.ts`), carregamento dos modelos (`models.ts`), combate e loop principal (`engine.ts`), pós-processamento (`postfx.ts`), texturas com relevo (`surfaces.ts`).
- `public/models/` — modelos que o jogo carrega: `ronin.glb` (personagem + malha leve dos inimigos + todos os clipes), `archer.glb`, `samurai2.glb` e `giant.glb` (inimigos) e `weapons/*.glb` (armas normalizadas: lâmina em +Z, fio em +Y, empunhadura na origem).
- `assets_src/` — arquivos originais enviados (FBX do Mixamo, pacotes de animação, GLBs das armas). Não vão para o deploy.
- `scripts/convert_characters.py`, `scripts/convert_weapons.py`, `scripts/optimize_models.mjs` — pipeline que gera `public/models/` a partir de `assets_src/` (veja abaixo).
- `src/App.tsx` — UI (menu, HUD, configurações) em React.
- `scripts/bake_textures.py` — gera as texturas procedurais em `public/tex/` (opcional, o resultado já fica versionado no repositório).
- `scripts/fetch_cc0_textures.py` — alternativa que baixa texturas CC0 do Poly Haven no lugar das procedurais.

## Pipeline de modelos 3D

Os arquivos em `public/models/` são gerados a partir de `assets_src/` — só é preciso rodar de novo ao trocar um modelo ou animação.

```bash
pip install bpy==5.0.1                 # Blender como módulo Python (Python 3.11)
python scripts/convert_characters.py ronin    # personagem + clipes (e retarget dos clipes de outros esqueletos)
python scripts/convert_characters.py archer   # arqueiro inimigo
python scripts/convert_characters.py samurai2 # segundo samurai (golpes do Rōnin via retarget)
python scripts/convert_characters.py giant    # chefe gigante (golpes do Rōnin via retarget)
python scripts/convert_weapons.py      # normaliza escala/eixo/empunhadura das armas
npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@0.22
node scripts/optimize_models.mjs       # compressão meshopt -> public/models/
```

Para acrescentar um clipe do Mixamo, adicione-o na tabela `*_CLIPS` do personagem (mesmo esqueleto) ou em `*_RETARGET` (outro esqueleto com nomes Mixamo) no `convert_characters.py`, e defina o uso dele em `moves.ts`/`engine.ts`.
