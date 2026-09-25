# Kage — jogo ninja 3D

Jogo de ação em terceira pessoa no navegador, feito com React, Vite e Three.js. Tudo — cenário, personagens, texturas, efeitos — é gerado por código; não há assets de terceiros com licença duvidosa. Controles sensíveis ao toque para celular e câmera automática.

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

## Estrutura

- `src/game/` — motor do jogo (Three.js puro): cenário (`world.ts`, `garden.ts`), personagens (`characters.ts`, `animation.ts`, `rigs.ts`), combate e loop principal (`engine.ts`), pós-processamento (`postfx.ts`), texturas com relevo (`surfaces.ts`).
- `src/App.tsx` — UI (menu, HUD, configurações) em React.
- `scripts/bake_textures.py` — gera as texturas procedurais em `public/tex/` (opcional, o resultado já fica versionado no repositório).
- `scripts/fetch_cc0_textures.py` — alternativa que baixa texturas CC0 do Poly Haven no lugar das procedurais.
